using System.Diagnostics;

namespace PromptNotebook;

static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try { Application.SetHighDpiMode(HighDpiMode.PerMonitorV2); } catch { }

        if (!Directory.Exists(Api.WebDir))
        {
            MessageBox.Show(
                "找不到 web 文件夹。\n\nexe 必须和 web、data 放在同一个目录里，不要单独拷贝 exe。\n\n" + Api.WebDir,
                "提示词记事本", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        Log.Write("==== start ====");
        Api.EnsureDirs();

        int port = Api.FreePort();
        for (int i = 0; i < args.Length - 1; i++)
            if (args[i] == "--port" && int.TryParse(args[i + 1], out var p) && p > 0) port = p;

        var app = Api.Build(port);
        try
        {
            app.StartAsync().GetAwaiter().GetResult();
        }
        catch (Exception e)
        {
            Log.Write("Kestrel 启动失败: " + e);
            MessageBox.Show("本地服务启动失败：\n" + e.Message, "提示词记事本",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        try
        {
            Application.Run(new MainForm($"http://127.0.0.1:{port}/"));
        }
        finally
        {
            Log.Write("---- exit ----");
            try { app.StopAsync().GetAwaiter().GetResult(); } catch { }
        }
    }
}
