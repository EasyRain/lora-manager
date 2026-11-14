using System.Net;
using System.Runtime.InteropServices;
using Microsoft.VisualBasic.FileIO;
using System.Net.Sockets;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging;

namespace PromptNotebook;

/// <summary>把原来 Python 那套 HTTP 接口原样搬到进程内，前端一行都不用改。</summary>
public static class Api
{
    /// <summary>由 MainForm 注入：把 action 丢到 WinForms 主线程（STA + 有消息泵）执行。</summary>
    public static Action<Action>? UiThread;

    public static string BaseDir => AppContext.BaseDirectory;
    public static string WebDir => Path.Combine(BaseDir, "web");
    public static string DataDir => Path.Combine(BaseDir, "data");
    public static string ImgDir => Path.Combine(DataDir, "images");
    public static string LibPath => Path.Combine(DataDir, "library.json");

    static readonly JsonSerializerOptions Pretty = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static int FreePort()
    {
        var l = new TcpListener(IPAddress.Loopback, 0);
        l.Start();
        int port = ((IPEndPoint)l.LocalEndpoint).Port;
        l.Stop();
        return port;
    }

    public static void EnsureDirs()
    {
        Directory.CreateDirectory(ImgDir);
        if (!File.Exists(LibPath))
            File.WriteAllText(LibPath, "{\n  \"version\": 2,\n  \"categories\": [],\n  \"folders\": [],\n  \"cards\": []\n}\n");
    }


    // ---------- LoRA 目录树 ----------
    static readonly string[] LoraExts = { ".safetensors", ".sft", ".ckpt", ".pt", ".pth", ".bin" };
    /// <summary>没在 library.json 里配过的话，猜一个；猜不到就空着让用户在界面上选。</summary>
    public static string DefaultRoot
    {
        get
        {
            var env = Environment.GetEnvironmentVariable("LORA_MANAGER_ROOT");
            if (!string.IsNullOrWhiteSpace(env) && Directory.Exists(env)) return env!;

            var dirs = new List<string> { AppContext.BaseDirectory };
            for (int i = 0; i < 4; i++)
            {
                var up = Path.GetFullPath(Path.Combine(dirs[^1], ".."));
                if (up.Length < 4) break;
                dirs.Add(up);
            }
            var rels = new[] { "models/loras", "../models/loras", "ComfyUI/models/loras", "../ComfyUI/models/loras" };
            foreach (var d in dirs)
                foreach (var r in rels)
                {
                    try
                    {
                        var p = Path.GetFullPath(Path.Combine(d, r));
                        if (Directory.Exists(p) && Directory.EnumerateFiles(p, "*.safetensors", System.IO.SearchOption.AllDirectories).Any())
                            return p;
                    }
                    catch { }
                }
            return "";
        }
    }

    public static string ReadRoot()
    {
        try
        {
            if (File.Exists(LibPath))
            {
                var node = JsonNode.Parse(File.ReadAllText(LibPath)) as JsonObject;
                var r = node?["root"]?.GetValue<string>();
                if (!string.IsNullOrWhiteSpace(r) && Directory.Exists(r)) return r!;
            }
        }
        catch { }
        return DefaultRoot;
    }

    public static bool RootConfigured()
    {
        try
        {
            if (File.Exists(LibPath))
            {
                var node = JsonNode.Parse(File.ReadAllText(LibPath)) as JsonObject;
                var r = node?["root"]?.GetValue<string>();
                if (!string.IsNullOrWhiteSpace(r)) return true;
            }
        }
        catch { }
        return !string.IsNullOrWhiteSpace(DefaultRoot);
    }

    static string Rel(string root, string full)
    {
        var r = Path.GetRelativePath(root, full);
        if (r == "." || r.Length == 0) return "";
        return r.Replace('\\', '/');
    }

    static string? SafeFull(string root, string rel)
    {
        rel = (rel ?? "").Replace('/', Path.DirectorySeparatorChar).TrimStart(Path.DirectorySeparatorChar);
        var full = Path.GetFullPath(Path.Combine(root, rel));
        var rootFull = Path.GetFullPath(root);
        if (!full.Equals(rootFull, StringComparison.OrdinalIgnoreCase) &&
            !full.StartsWith(rootFull.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar,
                             StringComparison.OrdinalIgnoreCase))
            return null;
        return full;
    }

    static void Walk(string root, string dir, List<object> dirs, List<object> files, int depth)
    {
        if (depth > 24) return;   // 只是防环保险；显示层级由前端的滑动窗口控制
        IEnumerable<string> subs, fs;
        try
        {
            subs = Directory.EnumerateDirectories(dir);
            fs = Directory.EnumerateFiles(dir);
        }
        catch { return; }

        foreach (var f in fs)
        {
            var ext = Path.GetExtension(f).ToLowerInvariant();
            if (!LoraExts.Contains(ext)) continue;
            var info = new FileInfo(f);
            files.Add(new { rel = Rel(root, f), name = Path.GetFileNameWithoutExtension(f), size = info.Length });
        }
        foreach (var sub in subs.OrderBy(x => x, StringComparer.CurrentCulture))
        {
            var name = Path.GetFileName(sub);
            if (name.StartsWith('.') || name.StartsWith('_') || name.Equals("__pycache__", StringComparison.OrdinalIgnoreCase))
                continue;
            dirs.Add(new { rel = Rel(root, sub), name, depth, parent = Rel(root, dir) });
            Walk(root, sub, dirs, files, depth + 1);
        }
    }

    static async Task<string> Sha256File(string path)
    {
        using var sha = System.Security.Cryptography.SHA256.Create();
        using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 20,
                                      FileOptions.SequentialScan);
        var buf = new byte[1 << 20];
        int n;
        while ((n = await fs.ReadAsync(buf)) > 0)
            sha.TransformBlock(buf, 0, n, null, 0);
        sha.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
        return Convert.ToHexString(sha.Hash!).ToLowerInvariant();
    }

    // ---------- 图片去重：内容哈希 ----------
    static readonly Dictionary<string, string> _imgHash = new(StringComparer.OrdinalIgnoreCase);
    static bool _imgHashReady;

    static string UrlOf(string fileName) => "/images/" + Uri.EscapeDataString(fileName);

    /// <summary>首次使用时把 data/images 里已有图片的哈希建进内存表。</summary>
    static void EnsureImgHash()
    {
        if (_imgHashReady) return;
        _imgHash.Clear();
        try
        {
            foreach (var f in Directory.EnumerateFiles(ImgDir))
            {
                try { _imgHash[Sha256File(f).GetAwaiter().GetResult()] = Path.GetFileName(f); }
                catch { }
            }
        }
        catch { }
        _imgHashReady = true;
    }

    /// <summary>library.json 里引用了这张图的条目数（用于判断能不能移走）。</summary>
    static int RefCount(string fileName)
    {
        try
        {
            var txt = File.Exists(LibPath) ? File.ReadAllText(LibPath) : "";
            if (txt.Length == 0) return 0;
            var needle = "/images/" + fileName;
            // 文件名可能是 ASCII（两种写法相同）或含中文（库里存的是转义形式），
            // 所以两种写法去重后再各数一次，别把同一个引用数两遍。
            var forms = new[] { needle, "/images/" + Uri.EscapeDataString(fileName) }
                        .Distinct(StringComparer.Ordinal);
            var n = 0;
            foreach (var form in forms)
            {
                var idx = 0;
                while ((idx = txt.IndexOf(form, idx, StringComparison.Ordinal)) >= 0)
                {
                    n++;
                    idx += form.Length;
                }
            }
            return n;
        }
        catch { return 0; }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct SHFILEOPSTRUCT
    {
        public IntPtr hwnd;
        public uint wFunc;
        [MarshalAs(UnmanagedType.LPWStr)] public string pFrom;
        [MarshalAs(UnmanagedType.LPWStr)] public string? pTo;
        public ushort fFlags;
        public int fAnyOperationsAborted;
        public IntPtr hNameMappings;
        [MarshalAs(UnmanagedType.LPWStr)] public string? lpszProgressTitle;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SHFileOperation(ref SHFILEOPSTRUCT lpFileOp);

    const uint FO_DELETE = 0x0003;
    const ushort FOF_SILENT = 0x0004;
    const ushort FOF_NOCONFIRMATION = 0x0010;
    const ushort FOF_ALLOWUNDO = 0x0040;
    const ushort FOF_NOERRORUI = 0x0400;
    const ushort FOF_WANTNUKEWARNING = 0x4000;   // 放不进回收站时先警告再彻底删除

    // ---- 用系统默认程序打开文件/文件夹 ----
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr ShellExecuteW(IntPtr hwnd, string? lpOperation, string lpFile,
                                       string? lpParameters, string? lpDirectory, int nShowCmd);

    /// <summary>依次尝试 ShellExecute → UseShellExecute → rundll32，返回是否成功。</summary>
    static bool OpenWithDefault(string path)
    {
        try
        {
            var r = (long)ShellExecuteW(IntPtr.Zero, "open", path, null, null, 1 /*SW_SHOWNORMAL*/);
            if (r > 32) return true;
            Log.Write("ShellExecute 失败 code=" + r);
        }
        catch (Exception e) { Log.Write("ShellExecute 异常: " + e.Message); }

        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = path,
                UseShellExecute = true,
            });
            return true;
        }
        catch (Exception e) { Log.Write("UseShellExecute 失败: " + e.Message); }

        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = "rundll32.exe",
                Arguments = "url.dll,FileProtocolHandler \"" + path + "\"",
                UseShellExecute = false,
                CreateNoWindow = true,
            });
            return true;
        }
        catch (Exception e) { Log.Write("rundll32 失败: " + e.Message); }

        return false;
    }

    // ---- 回收站删除 ----
    // 教训：进程内直接调 SHFileOperation / Microsoft.VisualBasic.FileIO.FileSystem，
    // 在 Kestrel 线程或 WinForms UI 线程上都会「返回成功但实际永久删除」。
    // 只有独立 STA 进程（这里用 PowerShell）才真正落到回收站，故改为派生子进程执行。
    [StructLayout(LayoutKind.Sequential)]
    struct SHQUERYRBINFO
    {
        public int cbSize;
        public long i64Size;
        public long i64NumItems;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SHQueryRecycleBin(string? pszRootPath, ref SHQUERYRBINFO pSHQueryRBInfo);

    /// <summary>该盘是否有可用回收站（没有时 SHFileOperation 会静默直接删除）。</summary>
    static bool DriveHasRecycleBin(string path)
    {
        try
        {
            var root = Path.GetPathRoot(Path.GetFullPath(path));
            if (string.IsNullOrEmpty(root)) return false;
            var info = new SHQUERYRBINFO { cbSize = Marshal.SizeOf<SHQUERYRBINFO>() };
            return SHQueryRecycleBin(root, ref info) == 0;
        }
        catch { return false; }
    }

    static long RecycleBinItems()
    {
        var info = new SHQUERYRBINFO { cbSize = Marshal.SizeOf<SHQUERYRBINFO>() };
        var hr = SHQueryRecycleBin(null, ref info);
        return hr == 0 ? info.i64NumItems : -1;
    }

    /// <summary>把文件送进回收站，返回真正消失掉的文件数。</summary>
    static int RecycleFiles(IEnumerable<string> paths)
    {
        var list = paths.Where(File.Exists).ToList();
        if (list.Count == 0) return 0;

        if (!DriveHasRecycleBin(list[0]))
        {
            Log.Write("该卷没有可用回收站（SHQueryRecycleBin 失败），只能永久删除: " +
                      string.Join(",", list.Select(Path.GetFileName)));
            var n0 = 0;
            foreach (var p in list) { try { File.Delete(p); n0++; } catch { } }
            return n0;
        }

        var before = RecycleBinItems();

        // 进程内直接 SHFileOperation：多文件用 \0 分隔，末尾再补一个 \0
        var from = string.Join("\0", list) + "\0\0";
        var op = new SHFILEOPSTRUCT
        {
            wFunc = FO_DELETE,
            pFrom = from,
            fFlags = (ushort)(FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI | FOF_WANTNUKEWARNING),
        };
        int hr;
        try { hr = SHFileOperation(ref op); }
        catch (Exception ex) { hr = -1; Log.Write("SHFileOperation 异常: " + ex.Message); }

        var after = RecycleBinItems();
        var gone = list.Count(p => !File.Exists(p));
        Log.Write($"recycle hr={hr} bin {before} -> {after}, gone {gone}/{list.Count}");

        if (gone == list.Count) return gone;

        // 兜底：仍然留在盘上的硬删，避免删一半
        var n = 0;
        foreach (var p in list.Where(File.Exists))
        {
            try { File.Delete(p); n++; } catch { }
        }
        return gone + n;
    }

    public static WebApplication Build(int port)
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(o =>
        {
            // 默认只有 30MB，LoRA 文件动不动上百兆，必须放开
            o.Limits.MaxRequestBodySize = 8L * 1024 * 1024 * 1024;
            o.Limits.MinRequestBodyDataRate = null;
            o.Limits.MinResponseDataRate = null;
            o.Listen(IPAddress.Loopback, port);
        });

        var app = builder.Build();

        // 静态资源：不缓存，改完刷新就生效
        var webProvider = new PhysicalFileProvider(WebDir);
        app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = webProvider });
        app.UseStaticFiles(new StaticFileOptions
        {
            FileProvider = webProvider,
            OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "no-store",
        });
        app.UseStaticFiles(new StaticFileOptions
        {
            FileProvider = new PhysicalFileProvider(ImgDir),
            RequestPath = "/images",
            OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "no-store",
        });

        app.MapGet("/api/ping", () => Results.Json(new { ok = true, root = BaseDir, port }));

        app.MapGet("/api/library", () =>
        {
            try
            {
                var bytes = File.ReadAllBytes(LibPath);
                return Results.Bytes(bytes, "application/json; charset=utf-8");
            }
            catch (Exception e)
            {
                return Results.Json(new { error = e.Message }, statusCode: 500);
            }
        });

        app.MapPut("/api/library", async (HttpContext ctx) =>
        {
            try
            {
                if (ctx.Request.ContentLength is null or <= 0 or > 32 * 1024 * 1024)
                    return Results.Json(new { error = "bad size" }, statusCode: 400);

                using var ms = new MemoryStream();
                await ctx.Request.Body.CopyToAsync(ms);
                var text = System.Text.Encoding.UTF8.GetString(ms.ToArray());

                var node = JsonNode.Parse(text);
                if (node is not JsonObject obj || obj["cards"] is null && obj["items"] is null)
                    return Results.Json(new { error = "invalid json" }, statusCode: 400);

                var stamp = DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss");
                obj["savedAt"] = stamp;

                if (File.Exists(LibPath)) File.Copy(LibPath, LibPath + ".bak", overwrite: true);

                var tmp = LibPath + ".tmp";
                File.WriteAllText(tmp, obj.ToJsonString(Pretty));
                File.Move(tmp, LibPath, overwrite: true);

                return Results.Json(new { ok = true, savedAt = stamp });
            }
            catch (Exception e)
            {
                return Results.Json(new { error = e.Message }, statusCode: 400);
            }
        });

        app.MapPost("/api/image", async (HttpContext ctx) =>
        {
            try
            {
                var name = ctx.Request.Query["name"].ToString();
                if (string.IsNullOrWhiteSpace(name)) name = "image.png";
                name = Path.GetFileName(name);
                var ext = Path.GetExtension(name).ToLowerInvariant();
                if (ext is not (".png" or ".jpg" or ".jpeg" or ".webp" or ".gif")) ext = ".png";
                using var ms = new MemoryStream();
                await ctx.Request.Body.CopyToAsync(ms);
                if (ms.Length == 0 || ms.Length > 64L * 1024 * 1024)
                    return Results.Json(new { error = "bad size" }, statusCode: 400);

                var bytes = ms.ToArray();
                var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)).ToLowerInvariant();

                EnsureImgHash();

                // ① 现有图片里已经有同一张 → 直接复用，不再存第二份
                if (_imgHash.TryGetValue(hash, out var exist) && File.Exists(Path.Combine(ImgDir, exist)))
                    return Results.Json(new { name = exist, url = UrlOf(exist), dedup = true });

                // ② 都没有才落盘（删除走系统回收站，不再去翻回收站文件夹）
                var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
                var rnd = Random.Shared.Next(0x1000, 0x10000).ToString("x4");
                var final = $"{stamp}-{rnd}{ext}";
                await File.WriteAllBytesAsync(Path.Combine(ImgDir, final), bytes);
                _imgHash[hash] = final;
                return Results.Json(new { name = final, url = UrlOf(final) });
            }
            catch (Exception e)
            {
                return Results.Json(new { error = e.Message }, statusCode: 500);
            }
        });

        // 删除 data/images 里的图片（只接受文件名，防止路径穿越）
        app.MapPost("/api/image/remove", async (HttpContext ctx) =>
        {
            try
            {
                var body = await JsonNode.ParseAsync(ctx.Request.Body);
                var arr = body?["names"]?.AsArray();
                var list = new List<string>();
                if (arr is not null)
                {
                    foreach (var it in arr)
                    {
                        var v = it?.GetValue<string>() ?? "";
                        if (!string.IsNullOrWhiteSpace(v)) list.Add(v);
                    }
                }
                else
                {
                    var one = body?["name"]?.GetValue<string>() ?? "";
                    if (!string.IsNullOrWhiteSpace(one)) list.Add(one);
                }

                var recycle = body?["recycle"]?.GetValue<bool>() ?? false;

                var targets = new List<string>();
                foreach (var raw in list)
                {
                    var fn = Path.GetFileName(raw.Trim());   // 丢弃任何目录部分
                    if (string.IsNullOrWhiteSpace(fn)) continue;
                    var full = Path.Combine(ImgDir, fn);
                    if (!full.StartsWith(ImgDir, StringComparison.OrdinalIgnoreCase)) continue;
                    if (!File.Exists(full)) continue;
                    targets.Add(full);
                }

                int removed;
                if (recycle)
                {
                    // 已保存过的图：进回收站，删错还能捞回来
                    removed = RecycleFiles(targets);
                }
                else
                {
                    // 本次编辑刚复制进来、还没保存的：直接删，别污染回收站
                    removed = 0;
                    foreach (var f in targets)
                    {
                        try
                        {
                            File.Delete(f);
                            var fn2 = Path.GetFileName(f);
                            foreach (var k in _imgHash.Where(kv => kv.Value == fn2).Select(kv => kv.Key).ToList())
                                _imgHash.Remove(k);
                            removed++;
                        }
                        catch { }
                    }
                }
                return Results.Json(new { ok = true, removed, recycle });
            }
            catch (Exception e)
            {
                return Results.Json(new { error = e.Message }, statusCode: 500);
            }
        });

        // 现存的图片文件名（前端用来找出失效引用）
        app.MapGet("/api/images/list", () =>
        {
            try
            {
                var names = Directory.EnumerateFiles(ImgDir)
                    .Select(Path.GetFileName)
                    .Where(x => !string.IsNullOrEmpty(x))
                    .ToList();
                return Results.Json(new { ok = true, names });
            }
            catch (Exception e) { return Results.Json(new { error = e.Message }, statusCode: 500); }
        });

        // 把图片移到应用内回收站（data/images/_trash），比系统回收站可靠
        // 删除图片 → 系统回收站（仍保留“别处还在引用就不动”的保护）
        app.MapPost("/api/image/recycle", async (HttpContext ctx) =>
        {
            try
            {
                var body = await JsonNode.ParseAsync(ctx.Request.Body);
                var arr = body?["names"]?.AsArray();
                var targets = new List<string>();
                if (arr is not null)
                {
                    foreach (var it in arr)
                    {
                        var raw = it?.GetValue<string>() ?? "";
                        var fn = Path.GetFileName(raw.Trim());
                        if (string.IsNullOrWhiteSpace(fn)) continue;
                        var full = Path.Combine(ImgDir, fn);
                        if (!File.Exists(full)) continue;
                        if (RefCount(fn) > 1) continue;      // 还有别的条目在用，不能动
                        targets.Add(full);
                    }
                }
                var removed = RecycleFiles(targets);
                foreach (var f in targets)
                {
                    var fn = Path.GetFileName(f);
                    foreach (var k in _imgHash.Where(kv => kv.Value == fn).Select(kv => kv.Key).ToList())
                        _imgHash.Remove(k);
                }
                return Results.Json(new { ok = true, removed });
            }
            catch (Exception e) { return Results.Json(new { error = e.Message }, statusCode: 500); }
        });

        // 用系统默认程序打开某张图片
        app.MapPost("/api/open", async (HttpContext ctx) =>
        {
            try
            {
                var body = await JsonNode.ParseAsync(ctx.Request.Body);
                var fn = Path.GetFileName((body?["name"]?.GetValue<string>() ?? "").Trim());
                if (string.IsNullOrWhiteSpace(fn)) return Results.Json(new { error = "缺少文件名" }, statusCode: 400);
                var full = Path.Combine(ImgDir, fn);
                if (!full.StartsWith(ImgDir, StringComparison.OrdinalIgnoreCase) || !File.Exists(full))
                    return Results.Json(new { error = "图片不存在" }, statusCode: 404);
                if (!OpenWithDefault(full))
                    return Results.Json(new { error = "系统没能打开这个文件（缺少关联程序？）" }, statusCode: 500);
                return Results.Json(new { ok = true });
            }
            catch (Exception e) { return Results.Json(new { error = e.Message }, statusCode: 500); }
        });

        app.MapPost("/api/reveal", () =>
        {
            try
            {
                OpenWithDefault(DataDir);
                return Results.Json(new { ok = true });
            }
            catch (Exception e)
            {
                return Results.Json(new { error = e.Message }, statusCode: 500);
            }
        });

        app.MapGet("/api/tree", () =>
        {
            var root = ReadRoot();
            if (string.IsNullOrWhiteSpace(root))
                return Results.Json(new { error = "还没有设置 LoRA 根目录，点顶栏「⚙ 根目录」选一个" }, statusCode: 400);
            if (!Directory.Exists(root))
                return Results.Json(new { error = "根目录不存在：" + root }, statusCode: 400);
            var dirs = new List<object>();
            var files = new List<object>();
            Walk(root, root, dirs, files, 1);
            return Results.Json(new { root, dirs, files });
        });

        app.MapPost("/api/mkdir", async (HttpContext ctx) =>
        {
            var root = ReadRoot();
            try
            {
                var body = await JsonNode.ParseAsync(ctx.Request.Body);
                var rel = body?["path"]?.GetValue<string>() ?? "";
                var full = SafeFull(root, rel);
                if (full is null) return Results.Json(new { error = "越界路径" }, statusCode: 400);
                Directory.CreateDirectory(full);
                return Results.Json(new { ok = true, rel = Rel(root, full) });
            }
            catch (Exception e) { return Results.Json(new { error = e.Message }, statusCode: 500); }
        });

        app.MapPost("/api/move", async (HttpContext ctx) =>
        {
            var root = ReadRoot();
            try
            {
                var body = await JsonNode.ParseAsync(ctx.Request.Body);
                var from = body?["from"]?.GetValue<string>() ?? "";
                var toDir = body?["to"]?.GetValue<string>() ?? "";

                var src = SafeFull(root, from);
                var dstDir = SafeFull(root, toDir);
                if (src is null || dstDir is null) return Results.Json(new { error = "越界路径" }, statusCode: 400);
                if (!File.Exists(src)) return Results.Json(new { error = "源文件不存在" }, statusCode: 404);

                Directory.CreateDirectory(dstDir);
                var dst = Path.Combine(dstDir, Path.GetFileName(src));
                if (File.Exists(dst))
                    return Results.Json(new { error = "目标里已经有同名文件" }, statusCode: 409);

                File.Move(src, dst);
                return Results.Json(new { ok = true, from = Rel(root, src), to = Rel(root, dst) });
            }
            catch (Exception e) { return Results.Json(new { error = e.Message }, statusCode: 500); }
        });

        app.MapPost("/api/rename", async (HttpContext ctx) =>
        {
            var root = ReadRoot();
            try
            {
                var body = await JsonNode.ParseAsync(ctx.Request.Body);
                var from = body?["from"]?.GetValue<string>() ?? "";
                var name = (body?["name"]?.GetValue<string>() ?? "").Trim();
                if (name.Length == 0) return Results.Json(new { error = "名字不能为空" }, statusCode: 400);

                var src = SafeFull(root, from);
                if (src is null) return Results.Json(new { error = "越界路径" }, statusCode: 400);
                bool isDir = Directory.Exists(src);
                if (!isDir && !File.Exists(src)) return Results.Json(new { error = "找不到" }, statusCode: 404);

                var parent = Path.GetDirectoryName(src)!;
                var target = Path.Combine(parent, isDir ? name : name + Path.GetExtension(src));
                if (File.Exists(target) || Directory.Exists(target))
                    return Results.Json(new { error = "同目录里已经有这个名字" }, statusCode: 409);

                if (isDir) Directory.Move(src, target); else File.Move(src, target);
                return Results.Json(new { ok = true, from = Rel(root, src), to = Rel(root, target) });
            }
            catch (Exception e) { return Results.Json(new { error = e.Message }, statusCode: 500); }
        });

        app.MapPost("/api/rmdir", async (HttpContext ctx) =>
        {
            var root = ReadRoot();
            try
            {
                var body = await JsonNode.ParseAsync(ctx.Request.Body);
                var rel = body?["path"]?.GetValue<string>() ?? "";
                var full = SafeFull(root, rel);
                if (full is null || full.Length == 0) return Results.Json(new { error = "越界路径" }, statusCode: 400);
                if (!Directory.Exists(full)) return Results.Json(new { error = "文件夹不存在" }, statusCode: 404);
                if (Directory.EnumerateFileSystemEntries(full).Any())
                    return Results.Json(new { error = "文件夹里还有东西，先清空" }, statusCode: 409);
                Directory.Delete(full);
                return Results.Json(new { ok = true });
            }
            catch (Exception e) { return Results.Json(new { error = e.Message }, statusCode: 500); }
        });

        app.MapPost("/api/upload", async (HttpContext ctx) =>
        {
            var root = ReadRoot();
            try
            {
                var dir = ctx.Request.Query["dir"].ToString();
                var name = Path.GetFileName(ctx.Request.Query["name"].ToString());
                if (string.IsNullOrWhiteSpace(name)) return Results.Json(new { error = "缺文件名" }, statusCode: 400);

                var ext = Path.GetExtension(name).ToLowerInvariant();
                if (!LoraExts.Contains(ext)) return Results.Json(new { error = "只接受 LoRA 文件（.safetensors 等）" }, statusCode: 400);

                var dirFull = SafeFull(root, dir) ?? root;
                Directory.CreateDirectory(dirFull);
                var target = Path.Combine(dirFull, name);
                if (File.Exists(target)) return Results.Json(new { error = "这个文件夹里已经有 " + name }, statusCode: 409);

                try
                {
                    using (var fs = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1 << 20))
                        await ctx.Request.Body.CopyToAsync(fs);
                }
                catch
                {
                    // 传到一半断了：把不完整的文件清掉，免得目录里留个 0 字节的假 LoRA
                    try { if (File.Exists(target)) File.Delete(target); } catch { }
                    throw;
                }

                return Results.Json(new { ok = true, rel = Rel(root, target) });
            }
            catch (Exception e) { return Results.Json(new { error = e.Message }, statusCode: 500); }
        });

        app.MapPost("/api/delete", async (HttpContext ctx) =>
        {
            var root = ReadRoot();
            try
            {
                var body = await JsonNode.ParseAsync(ctx.Request.Body);
                var rel = body?["path"]?.GetValue<string>() ?? "";
                var full = SafeFull(root, rel);
                if (full is null || full.Length == 0) return Results.Json(new { error = "越界路径" }, statusCode: 400);
                if (!File.Exists(full)) return Results.Json(new { error = "文件不存在" }, statusCode: 404);

                RecycleFiles(new[] { full });   // 进回收站（STA）
                return Results.Json(new { ok = true, rel = Rel(root, full) });
            }
            catch (Exception e) { return Results.Json(new { error = e.Message }, statusCode: 500); }
        });

        app.MapPost("/api/hash", async (HttpContext ctx) =>
        {
            var root = ReadRoot();
            try
            {
                var body = await JsonNode.ParseAsync(ctx.Request.Body);
                var list = body?["paths"]?.AsArray();
                if (list is null) return Results.Json(new { error = "缺 paths" }, statusCode: 400);

                var map = new Dictionary<string, string>();
                foreach (var item in list)
                {
                    var rel = item?.GetValue<string>() ?? "";
                    var full = SafeFull(root, rel);
                    if (full is null || !File.Exists(full)) continue;
                    map[rel] = await Sha256File(full);
                }
                return Results.Json(new { hashes = map });
            }
            catch (Exception e) { return Results.Json(new { error = e.Message }, statusCode: 500); }
        });

        app.MapPost("/api/civitai/ping", async () =>
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
                http.DefaultRequestHeaders.UserAgent.ParseAdd("lora-manager/0.1");
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                using var resp = await http.GetAsync("https://civitai.com/api/v1/models?limit=1", cts.Token);
                return Results.Json(new { ok = resp.IsSuccessStatusCode, ms = sw.ElapsedMilliseconds, status = (int)resp.StatusCode });
            }
            catch (Exception e)
            {
                return Results.Json(new { ok = false, ms = sw.ElapsedMilliseconds, error = e.Message });
            }
        });

        app.MapPost("/api/civitai/lookup", async (HttpContext ctx) =>
        {
            var root = ReadRoot();
            try
            {
                var body = await JsonNode.ParseAsync(ctx.Request.Body);
                var hashIn = body?["hash"]?.GetValue<string>() ?? "";
                var hash = hashIn;
                if (string.IsNullOrWhiteSpace(hash))
                {
                    var rel = body?["path"]?.GetValue<string>() ?? "";
                    var full = SafeFull(root, rel);
                    if (full is null) return Results.Json(new { error = "越界路径" }, statusCode: 400);
                    if (!File.Exists(full)) return Results.Json(new { error = "文件不存在" }, statusCode: 404);
                    hash = await Sha256File(full);
                }

                using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(25) };
                http.DefaultRequestHeaders.UserAgent.ParseAdd("lora-manager/0.1");
                http.DefaultRequestHeaders.Accept.ParseAdd("application/json");

                using var resp = await http.GetAsync("https://civitai.com/api/v1/model-versions/by-hash/" + hash);
                if (resp.StatusCode == System.Net.HttpStatusCode.NotFound)
                    return Results.Json(new { found = false, hash });
                if (!resp.IsSuccessStatusCode)
                    return Results.Json(new { error = "Civitai 返回 " + (int)resp.StatusCode, hash }, statusCode: 502);

                var doc = JsonNode.Parse(await resp.Content.ReadAsStringAsync());
                var versionId = doc?["id"]?.GetValue<long>() ?? 0;
                var modelId = doc?["modelId"]?.GetValue<long>() ?? 0;
                if (modelId == 0) return Results.Json(new { found = false, hash });

                var url = "https://civitai.com/models/" + modelId + "?modelVersionId=" + versionId;
                var title = doc?["model"]?["name"]?.GetValue<string>() ?? "";
                return Results.Json(new { found = true, hash, modelId, versionId, url, title });
            }
            catch (TaskCanceledException)
            {
                return Results.Json(new { error = "连不上 Civitai（超时，检查代理）" }, statusCode: 504);
            }
            catch (Exception e)
            {
                return Results.Json(new { error = e.Message }, statusCode: 500);
            }
        });

        app.MapPost("/api/reveal-file", async (HttpContext ctx) =>
        {
            var root = ReadRoot();
            try
            {
                var body = await JsonNode.ParseAsync(ctx.Request.Body);
                var rel = body?["path"]?.GetValue<string>() ?? "";
                var full = SafeFull(root, rel);
                if (full is null) return Results.Json(new { error = "越界路径" }, statusCode: 400);
                // 目录 → 直接打开；文件 → 打开它所在的文件夹（不去"运行"这个文件）
                if (Directory.Exists(full)) OpenWithDefault(full);
                else if (File.Exists(full))
                {
                    var dir = Path.GetDirectoryName(full);
                    if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir))
                        return Results.Json(new { error = "找不到所在目录" }, statusCode: 404);
                    OpenWithDefault(dir);
                }
                else return Results.Json(new { error = "找不到" }, statusCode: 404);
                return Results.Json(new { ok = true });
            }
            catch (Exception e) { return Results.Json(new { error = e.Message }, statusCode: 500); }
        });

        return app;
    }

    static string Sanitize(string s)
    {
        var arr = s.Select(c => char.IsLetterOrDigit(c) || c is '.' or '-' or '_' || c > 0x2E80 ? c : '_').ToArray();
        var r = new string(arr).Trim('.', '_');
        return r.Length == 0 ? "image" : r;
    }
}
