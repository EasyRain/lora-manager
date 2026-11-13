using System.Diagnostics;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace PromptNotebook;

public class MainForm : Form
{
    readonly WebView2 _web;
    readonly string _url;

    internal WebView2 Web => _web;

    public MainForm(string url)
    {
        _url = url;
        Text = "LoRA 管理器";
        Width = 1280;
        Height = 880;
        MinimumSize = new Size(780, 520);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(21, 21, 24);

        _web = new WebView2
        {
            Dock = DockStyle.Fill,
            DefaultBackgroundColor = Color.FromArgb(21, 21, 24),
        };
        Controls.Add(_web);
        Load += async (_, _) => await InitAsync();
        Application.AddMessageFilter(new SideButtonFilter(this));
    }

    async Task InitAsync()
    {
        try
        {
            // 放在程序目录里：可移植，也不会撞上别的目录权限
            string udf = Path.Combine(AppContext.BaseDirectory, "webview-data");
            try
            {
                Directory.CreateDirectory(udf);
                var probe = Path.Combine(udf, ".w");
                File.WriteAllText(probe, "1");
                File.Delete(probe);
            }
            catch
            {
                udf = Path.Combine(Path.GetTempPath(), "PromptNotebookWebView2");
                Directory.CreateDirectory(udf);
            }

            Log.Write("WebView2 UDF = " + udf);
            var env = await CoreWebView2Environment.CreateAsync(null, udf);
            await _web.EnsureCoreWebView2Async(env);

            // 页面标题变了（切语言），窗口标题也跟着变
            _web.CoreWebView2.DocumentTitleChanged += (_, _) =>
            {
                var docTitle = _web.CoreWebView2.DocumentTitle;
                if (!string.IsNullOrWhiteSpace(docTitle)) Text = docTitle;
            };

            var s = _web.CoreWebView2.Settings;
            s.IsStatusBarEnabled = false;
            s.AreDevToolsEnabled = true;
            s.IsZoomControlEnabled = true;
            s.IsSwipeNavigationEnabled = false;

            // 外链交给系统浏览器，不要在应用窗口里开
            _web.CoreWebView2.NewWindowRequested += (_, e) =>
            {
                e.Handled = true;
                try
                {
                    Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true });
                }
                catch { /* 打不开就算了 */ }
            };

            Log.Write("navigate " + _url);
            _web.CoreWebView2.Navigate(_url);
        }
        catch (Exception e)
        {
            Log.Write("WebView2 初始化失败: " + e);
            MessageBox.Show(
                "WebView2 初始化失败：\n" + e.Message +
                "\n\n这台机器可能缺少 WebView2 运行时（Edge 一般自带）。",
                "LoRA 管理器", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    /// <summary>截获鼠标侧键（XBUTTON1/2），转成页面里的前进/后退。</summary>
    sealed class SideButtonFilter : IMessageFilter
    {
        const int WM_XBUTTONDOWN = 0x020B;
        readonly MainForm _form;

        public SideButtonFilter(MainForm form) { _form = form; }

        public bool PreFilterMessage(ref Message m)
        {
            if (m.Msg != WM_XBUTTONDOWN) return false;
            var core = _form.Web.CoreWebView2;
            if (core is null) return false;

            // WParam 高 16 位 = 哪个侧键（1 = 后退，2 = 前进）
            var which = (long)m.WParam >> 16 & 0xFFFF;
            core.ExecuteScriptAsync(which == 1
                ? "window.__navBack && window.__navBack()"
                : "window.__navForward && window.__navForward()");
            return true;   // 吃掉，别让 WebView2 再触发它自己的历史导航
        }
    }
}
