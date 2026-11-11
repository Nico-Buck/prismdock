// PrismDock taskbar guardian.
// A tiny process started outside PrismDock's process job, only while the Windows taskbar is hidden.
// It waits until the PrismDock main process is gone. If the restore file still exists - PrismDock did
// not restore the taskbar itself because it crashed or was killed - it applies the saved auto-hide
// state, shows the taskbar windows again and deletes the file.
// Compiled once by helper.ps1 (Add-Type -OutputAssembly); a native exe needs ~5 MB instead of the
// ~60 MB a PowerShell instance would keep around for hours.
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;

static class PrismGuard {
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string c, string t);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr p, IntPtr a, string c, string t);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
    [StructLayout(LayoutKind.Sequential)] struct APPBARDATA { public int cb; public IntPtr h; public uint m; public uint e; public int l, t, r, b; public IntPtr p; }
    [DllImport("shell32.dll")] static extern UIntPtr SHAppBarMessage(uint m, ref APPBARDATA d);

    static int Main(string[] args) {
        if (args.Length < 2) return 1;
        int pid; if (!int.TryParse(args[0], out pid)) return 1;
        string file = args[1];
        try { using (var p = Process.GetProcessById(pid)) p.WaitForExit(); } catch { /* already gone */ }
        Thread.Sleep(800);
        if (!File.Exists(file)) return 0; // PrismDock restored the taskbar itself

        int state = 0;
        try { var m = Regex.Match(File.ReadAllText(file), "\"state\"\\s*:\\s*(\\d+)"); if (m.Success) state = int.Parse(m.Groups[1].Value); } catch { }
        IntPtr tb = FindWindow("Shell_TrayWnd", null);
        if (tb != IntPtr.Zero) {
            var d = new APPBARDATA(); d.cb = Marshal.SizeOf(typeof(APPBARDATA)); d.h = tb; d.p = (IntPtr)state;
            SHAppBarMessage(10, ref d); // ABM_SETSTATE: the user's original auto-hide setting
            ShowWindow(tb, 5);
        }
        IntPtr s = IntPtr.Zero;
        while ((s = FindWindowEx(IntPtr.Zero, s, "Shell_SecondaryTrayWnd", null)) != IntPtr.Zero) ShowWindow(s, 5);
        try { File.Delete(file); } catch { }
        return 0;
    }
}
