using System.Net;
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
        if (depth > 6) return;
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

                // 统一命名：年月日-时分秒-4位随机，按名字排序就是时间顺序
                var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
                var rnd = Random.Shared.Next(0x1000, 0x10000).ToString("x4");
                var final = $"{stamp}-{rnd}{ext}";
                await File.WriteAllBytesAsync(Path.Combine(ImgDir, final), ms.ToArray());
                return Results.Json(new { name = final, url = "/images/" + Uri.EscapeDataString(final) });
            }
            catch (Exception e)
            {
                return Results.Json(new { error = e.Message }, statusCode: 500);
            }
        });

        app.MapPost("/api/reveal", () =>
        {
            try
            {
                System.Diagnostics.Process.Start("explorer.exe", DataDir);
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

                try
                {
                    // 进回收站，删错了还能捞回来
                    FileSystem.DeleteFile(full, UIOption.OnlyErrorDialogs, RecycleOption.SendToRecycleBin);
                }
                catch
                {
                    File.Delete(full);
                }
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
                if (Directory.Exists(full)) System.Diagnostics.Process.Start("explorer.exe", full);
                else if (File.Exists(full)) System.Diagnostics.Process.Start("explorer.exe", "/select,\"" + full + "\"");
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
