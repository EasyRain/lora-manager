namespace PromptNotebook;

static class Log
{
    static readonly object Gate = new();
    public static string Path_ => System.IO.Path.Combine(AppContext.BaseDirectory, "shell.log");

    public static void Write(string msg)
    {
        try
        {
            lock (Gate)
                File.AppendAllText(Path_, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss ") + msg + Environment.NewLine);
        }
        catch { }
    }
}
