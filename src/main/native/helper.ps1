# PrismDock native bridge.
# One long-lived process. Reads one JSON request per line from stdin, writes one JSON response per line.
# Request: {"id":1,"cmd":"cpu","args":{}}   Response: {"id":1,"ok":true,"result":...}

$ErrorActionPreference = 'Stop'
# runs without a console (detached), so talk through explicit UTF-8 streams
$utf8 = New-Object System.Text.UTF8Encoding $false
$script:stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)
$script:stdout = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $utf8)
$script:stdout.AutoFlush = $true

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$src = @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class PD {
    // ---------- CPU ----------
    [DllImport("kernel32.dll")] static extern bool GetSystemTimes(out long idle, out long kernel, out long user);
    static long _pi, _pk, _pu;
    public static double Cpu() {
        long i, k, u; GetSystemTimes(out i, out k, out u);
        long di = i - _pi, dk = k - _pk, du = u - _pu;
        _pi = i; _pk = k; _pu = u;
        long total = dk + du;
        if (total <= 0) return 0;
        return Math.Max(0, Math.Min(100, (total - di) * 100.0 / total));
    }

    // ---------- Memory ----------
    [StructLayout(LayoutKind.Sequential)]
    public class MEMSTAT { public uint len = 64; public uint load; public ulong totalPhys, availPhys, totalPage, availPage, totalVirt, availVirt, availExt; }
    [DllImport("kernel32.dll")] static extern bool GlobalMemoryStatusEx([In, Out] MEMSTAT m);
    public static ulong[] Mem() { var m = new MEMSTAT(); GlobalMemoryStatusEx(m); return new ulong[] { m.totalPhys, m.availPhys }; }

    // ---------- Battery ----------
    [StructLayout(LayoutKind.Sequential)]
    public struct PWR { public byte ac; public byte flag; public byte percent; public byte saver; public int lifeTime; public int fullLifeTime; }
    [DllImport("kernel32.dll")] static extern bool GetSystemPowerStatus(out PWR p);
    public static int[] Battery() { PWR p; GetSystemPowerStatus(out p); return new int[] { p.ac, p.flag, p.percent, p.saver, p.lifeTime }; }

    // ---------- Network ----------
    public static long[] Net() {
        long rx = 0, tx = 0;
        foreach (var n in System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces()) {
            if (n.OperationalStatus != System.Net.NetworkInformation.OperationalStatus.Up) continue;
            if (n.NetworkInterfaceType == System.Net.NetworkInformation.NetworkInterfaceType.Loopback) continue;
            try { var s = n.GetIPStatistics(); rx += s.BytesReceived; tx += s.BytesSent; } catch {}
        }
        return new long[] { rx, tx };
    }

    // ---------- Performance counters (GPU / thermal) ----------
    static List<PerformanceCounter> _gpu; static DateTime _gpuAt = DateTime.MinValue;
    public static double Gpu() {
        try {
            if (_gpu == null || (DateTime.Now - _gpuAt).TotalSeconds > 15) {
                _gpu = new List<PerformanceCounter>();
                var cat = new PerformanceCounterCategory("GPU Engine");
                foreach (var name in cat.GetInstanceNames()) {
                    if (name.EndsWith("engtype_3D")) _gpu.Add(new PerformanceCounter("GPU Engine", "Utilization Percentage", name, true));
                }
                foreach (var c in _gpu) { try { c.NextValue(); } catch {} }
                _gpuAt = DateTime.Now;
                System.Threading.Thread.Sleep(120);
            }
            double sum = 0;
            foreach (var c in _gpu) { try { sum += c.NextValue(); } catch {} }
            return Math.Min(100, sum);
        } catch { return -1; }
    }
    static List<PerformanceCounter> _therm;
    public static double[] Thermal() {
        try {
            if (_therm == null) {
                _therm = new List<PerformanceCounter>();
                var cat = new PerformanceCounterCategory("Thermal Zone Information");
                foreach (var name in cat.GetInstanceNames()) _therm.Add(new PerformanceCounter("Thermal Zone Information", "Temperature", name, true));
            }
            var r = new List<double>();
            foreach (var c in _therm) { try { double k = c.NextValue(); if (k > 200) r.Add(Math.Round(k - 273.15, 1)); } catch {} }
            return r.ToArray();
        } catch { return new double[0]; }
    }

    // ---------- Disk ----------
    public static List<object[]> Disks() {
        var l = new List<object[]>();
        foreach (var d in DriveInfo.GetDrives()) {
            try { if (d.IsReady && (d.DriveType == DriveType.Fixed || d.DriveType == DriveType.Removable)) l.Add(new object[] { d.Name, d.VolumeLabel, d.TotalSize, d.TotalFreeSpace }); } catch {}
        }
        return l;
    }

    // ---------- Recycle bin ----------
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    public struct RBINFO { public int cbSize; public long size; public long items; }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHQueryRecycleBin(string root, ref RBINFO info);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHEmptyRecycleBin(IntPtr hwnd, string root, uint flags);
    public static long[] Recycle() { var i = new RBINFO(); i.cbSize = Marshal.SizeOf(typeof(RBINFO)); SHQueryRecycleBin(null, ref i); return new long[] { i.items, i.size }; }
    public static int EmptyRecycle() { return SHEmptyRecycleBin(IntPtr.Zero, null, 0x1 | 0x2 | 0x4); }

    // ---------- Audio (Core Audio): endpoints, default device, per-app sessions ----------
    [StructLayout(LayoutKind.Sequential)] public struct PROPERTYKEY { public Guid fmtid; public int pid; }
    [StructLayout(LayoutKind.Explicit, Size = 24)] public struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; }
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PROPVARIANT pv);
    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume {
        void RegisterControlChangeNotify(IntPtr p); void UnregisterControlChangeNotify(IntPtr p);
        void GetChannelCount(out uint c);
        void SetMasterVolumeLevel(float l, ref Guid g); void SetMasterVolumeLevelScalar(float l, ref Guid g);
        void GetMasterVolumeLevel(out float l); void GetMasterVolumeLevelScalar(out float l);
        void SetChannelVolumeLevel(uint c, float l, ref Guid g); void SetChannelVolumeLevelScalar(uint c, float l, ref Guid g);
        void GetChannelVolumeLevel(uint c, out float l); void GetChannelVolumeLevelScalar(uint c, out float l);
        void SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid g); void GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
    }
    [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore { void GetCount(out uint c); void GetAt(uint i, out PROPERTYKEY k); void GetValue(ref PROPERTYKEY k, out PROPVARIANT v); }
    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice { void Activate(ref Guid id, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); void OpenPropertyStore(int a, out IPropertyStore s); void GetId([MarshalAs(UnmanagedType.LPWStr)] out string id); void GetState(out int s); }
    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection { void GetCount(out uint c); void Item(uint i, out IMMDevice d); }
    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator { void EnumAudioEndpoints(int f, int m, out IMMDeviceCollection d); [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice dev); void GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice d); }
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}
    // Undocumented but stable since Windows 7: what the Sound control panel uses to set the default device.
    [ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPolicyConfig { void s1(); void s2(); void s3(); void s4(); void s5(); void s6(); void s7(); void s8(); void s9(); void s10(); [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role); }
    // IPolicyConfigVista: one method fewer before SetDefaultEndpoint (no ResetDeviceFormat)
    [ComImport, Guid("568b9108-44bf-40b4-9006-86afe5b5a620"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPolicyConfigVista { void s1(); void s2(); void s3(); void s4(); void s5(); void s6(); void s7(); void s8(); void s9(); [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role); }
    static readonly Guid[] PolicyClasses = { new Guid("870af99c-171d-4f9e-af0d-e63df40c5bc9"), new Guid("294935ce-f637-4e7c-a41b-ab255460b862") };
    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2 { void GetAudioSessionControl(IntPtr g, int f, out IntPtr c); void GetSimpleAudioVolume(IntPtr g, int f, out IntPtr v); void GetSessionEnumerator(out IAudioSessionEnumerator e); }
    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator { void GetCount(out int c); void GetSession(int i, out IAudioSessionControl2 s); }
    [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2 {
        void GetState(out int s); void GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string n); void SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string n, ref Guid g);
        void GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string p); void SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string p, ref Guid g);
        void GetGroupingParam(out Guid g); void SetGroupingParam(ref Guid g, ref Guid c); void RegisterAudioSessionNotification(IntPtr n); void UnregisterAudioSessionNotification(IntPtr n);
        void GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string s); void GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string s);
        void GetProcessId(out uint pid); [PreserveSig] int IsSystemSoundsSession();
    }
    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ISimpleAudioVolume { void SetMasterVolume(float l, ref Guid g); void GetMasterVolume(out float l); void SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid g); void GetMute([MarshalAs(UnmanagedType.Bool)] out bool m); }

    static IMMDeviceEnumerator Enm() { return (IMMDeviceEnumerator)(new MMDeviceEnumerator()); }
    static IMMDevice DefaultDev(int flow) { IMMDevice d; return Enm().GetDefaultAudioEndpoint(flow, 1, out d) == 0 ? d : null; }
    static T Act<T>(IMMDevice d) { var iid = typeof(T).GUID; object o; d.Activate(ref iid, 23, IntPtr.Zero, out o); return (T)o; }
    static string DevName(IMMDevice d) {
        try {
            IPropertyStore ps; d.OpenPropertyStore(0, out ps);
            var k = new PROPERTYKEY(); k.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"); k.pid = 14;
            PROPVARIANT v; ps.GetValue(ref k, out v);
            string s = v.vt == 31 ? Marshal.PtrToStringUni(v.p) : ""; PropVariantClear(ref v); return s;
        } catch { return ""; }
    }
    // flow 0 = output (render), 1 = input (capture)
    public static object[] GetVolume(int flow) {
        var d = DefaultDev(flow); if (d == null) return new object[] { -1, false, "", "" };
        var v = Act<IAudioEndpointVolume>(d); float l; bool m; v.GetMasterVolumeLevelScalar(out l); v.GetMute(out m);
        string id; d.GetId(out id);
        return new object[] { Math.Round(l * 100), m, DevName(d), id };
    }
    public static void SetVolume(int flow, double pct) { var d = DefaultDev(flow); if (d == null) return; var g = Guid.Empty; Act<IAudioEndpointVolume>(d).SetMasterVolumeLevelScalar((float)Math.Max(0, Math.Min(1, pct / 100.0)), ref g); }
    public static void SetMute(int flow, bool m) { var d = DefaultDev(flow); if (d == null) return; var g = Guid.Empty; Act<IAudioEndpointVolume>(d).SetMute(m, ref g); }

    // Live output volume: Core Audio calls OnNotify for every change (headset wheel, keyboard keys, other
    // apps), which is pushed as {"event":"volume"} so the dock follows without polling. The watcher runs on
    // its own (MTA) thread and re-registers when the default output device changes.
    [ComImport, Guid("657804FA-D6AD-4496-8A60-352752AF4F89"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioEndpointVolumeCallback { [PreserveSig] int OnNotify(IntPtr data); }
    class VolCb : IAudioEndpointVolumeCallback {
        public int OnNotify(IntPtr data) {
            // AUDIO_VOLUME_NOTIFICATION_DATA: Guid context (16), BOOL muted, float master
            bool muted = Marshal.ReadInt32(data, 16) != 0;
            float lvl = BitConverter.ToSingle(BitConverter.GetBytes(Marshal.ReadInt32(data, 20)), 0);
            Emit("{\"event\":\"volume\",\"level\":" + Math.Round(lvl * 100) + ",\"muted\":" + (muted ? "true" : "false") + "}");
            return 0;
        }
    }
    static System.Threading.Thread _volThread;
    public static void WatchVolume() {
        if (_volThread != null) return;
        _volThread = new System.Threading.Thread(delegate() {
            string devId = null; IAudioEndpointVolume ep = null; IntPtr cb = IntPtr.Zero; var keep = new VolCb();
            while (true) {
                try {
                    var d = DefaultDev(0); string id = null; if (d != null) d.GetId(out id);
                    if (id != devId) {
                        if (ep != null && cb != IntPtr.Zero) { try { ep.UnregisterControlChangeNotify(cb); } catch { } Marshal.Release(cb); cb = IntPtr.Zero; ep = null; }
                        devId = id;
                        if (d != null) {
                            ep = Act<IAudioEndpointVolume>(d);
                            cb = Marshal.GetComInterfaceForObject(keep, typeof(IAudioEndpointVolumeCallback));
                            ep.RegisterControlChangeNotify(cb);
                            float l; bool m; ep.GetMasterVolumeLevelScalar(out l); ep.GetMute(out m);
                            Emit("{\"event\":\"volume\",\"level\":" + Math.Round(l * 100) + ",\"muted\":" + (m ? "true" : "false") + ",\"device\":true}");
                        }
                    }
                } catch { devId = null; }
                System.Threading.Thread.Sleep(2000); // default-device switches only; volume itself is event-driven
            }
        });
        _volThread.IsBackground = true; _volThread.SetApartmentState(System.Threading.ApartmentState.MTA); _volThread.Start();
    }
    public static List<object[]> Devices(int flow) {
        var l = new List<object[]>(); IMMDeviceCollection c; Enm().EnumAudioEndpoints(flow, 1, out c); uint n; c.GetCount(out n);
        var def = DefaultDev(flow); string defId = ""; if (def != null) def.GetId(out defId);
        for (uint i = 0; i < n; i++) { IMMDevice d; c.Item(i, out d); string id; d.GetId(out id); l.Add(new object[] { id, DevName(d), id == defId }); }
        return l;
    }
    public static bool SetDefaultDevice(string id) {
        foreach (var clsid in PolicyClasses) {
            object o; try { o = Activator.CreateInstance(Type.GetTypeFromCLSID(clsid, true)); } catch { continue; }
            var p = o as IPolicyConfig;
            if (p != null) { int r = p.SetDefaultEndpoint(id, 0); p.SetDefaultEndpoint(id, 1); p.SetDefaultEndpoint(id, 2); if (r == 0) return true; }
            var pv = o as IPolicyConfigVista;
            if (pv != null) { int r = pv.SetDefaultEndpoint(id, 0); pv.SetDefaultEndpoint(id, 1); pv.SetDefaultEndpoint(id, 2); if (r == 0) return true; }
        }
        throw new Exception("Windows did not accept the device change");
    }
    static List<IAudioSessionControl2> SessionsOf() {
        var l = new List<IAudioSessionControl2>();
        var d = DefaultDev(0); if (d == null) return l;
        IAudioSessionEnumerator e; Act<IAudioSessionManager2>(d).GetSessionEnumerator(out e); int n; e.GetCount(out n);
        for (int i = 0; i < n; i++) { IAudioSessionControl2 s; e.GetSession(i, out s); l.Add(s); }
        return l;
    }
    static T Mta<T>(Func<T> fn) { T r = default(T); Exception ex = null; var t = new System.Threading.Thread(delegate() { try { r = fn(); } catch (Exception e) { ex = e; } }); t.SetApartmentState(System.Threading.ApartmentState.MTA); t.Start(); t.Join(); if (ex != null) throw ex; return r; }
    public static List<object[]> Sessions() { return Mta(new Func<List<object[]>>(SessionsImpl)); }
    public static bool SetSession(string inst, double vol, int mute) { return Mta(new Func<bool>(delegate() { return SetSessionImpl(inst, vol, mute); })); }
    static List<object[]> SessionsImpl() {
        var l = new List<object[]>();
        foreach (var s in SessionsOf()) {
            int st; s.GetState(out st); if (st == 2) continue; // expired
            uint pid; s.GetProcessId(out pid); string inst; s.GetSessionInstanceIdentifier(out inst);
            string name; s.GetDisplayName(out name);
            bool sys = s.IsSystemSoundsSession() == 0;
            string exe = sys ? "" : ExePath(pid);
            if (sys) name = "System sounds";
            else if (string.IsNullOrEmpty(name) || name.StartsWith("@")) {
                try { var fv = FileVersionInfo.GetVersionInfo(exe); name = !string.IsNullOrEmpty(fv.FileDescription) ? fv.FileDescription : Path.GetFileNameWithoutExtension(exe); } catch { name = "App " + pid; }
            }
            var v = (ISimpleAudioVolume)s; float vol; bool m; v.GetMasterVolume(out vol); v.GetMute(out m);
            l.Add(new object[] { inst, name, exe, (long)pid, Math.Round(vol * 100), m, st == 1, sys });
        }
        return l;
    }
    static bool SetSessionImpl(string inst, double vol, int mute) {
        foreach (var s in SessionsOf()) {
            string id; s.GetSessionInstanceIdentifier(out id); if (id != inst) continue;
            var v = (ISimpleAudioVolume)s; var g = Guid.Empty;
            if (vol >= 0) v.SetMasterVolume((float)Math.Max(0, Math.Min(1, vol / 100.0)), ref g);
            if (mute >= 0) v.SetMute(mute == 1, ref g);
            return true;
        }
        return false;
    }

    // ---------- External monitor brightness (DDC/CI) ----------
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct PHYSMON { public IntPtr h; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string desc; }
    delegate bool MonEnum(IntPtr hMon, IntPtr hdc, IntPtr rect, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonEnum cb, IntPtr data);
    [DllImport("dxva2.dll")] static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr h, out uint n);
    [DllImport("dxva2.dll")] static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr h, uint n, [Out] PHYSMON[] arr);
    [DllImport("dxva2.dll")] static extern bool GetMonitorBrightness(IntPtr h, out uint min, out uint cur, out uint max);
    [DllImport("dxva2.dll")] static extern bool SetMonitorBrightness(IntPtr h, uint v);
    [DllImport("dxva2.dll")] static extern bool DestroyPhysicalMonitors(uint n, PHYSMON[] arr);
    static List<PHYSMON[]> Phys() {
        var all = new List<PHYSMON[]>();
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr h, IntPtr dc, IntPtr r, IntPtr d) {
            uint n; if (GetNumberOfPhysicalMonitorsFromHMONITOR(h, out n) && n > 0) { var a = new PHYSMON[n]; if (GetPhysicalMonitorsFromHMONITOR(h, n, a)) all.Add(a); }
            return true; }, IntPtr.Zero);
        return all;
    }
    public static int DdcGet() {
        int res = -1;
        foreach (var a in Phys()) { foreach (var m in a) { uint mi, c, ma; if (res < 0 && GetMonitorBrightness(m.h, out mi, out c, out ma) && ma > mi) res = (int)Math.Round((c - mi) * 100.0 / (ma - mi)); } DestroyPhysicalMonitors((uint)a.Length, a); }
        return res;
    }
    public static bool DdcSet(int pct) {
        bool ok = false;
        foreach (var a in Phys()) { foreach (var m in a) { uint mi, c, ma; if (GetMonitorBrightness(m.h, out mi, out c, out ma)) { ok |= SetMonitorBrightness(m.h, (uint)(mi + (ma - mi) * pct / 100.0)); } } DestroyPhysicalMonitors((uint)a.Length, a); }
        return ok;
    }

    // ---------- Windows ----------
    delegate bool WndEnum(IntPtr h, IntPtr p);
    [DllImport("user32.dll")] static extern bool EnumWindows(WndEnum cb, IntPtr p);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int f, StringBuilder s, ref int n);

    public static string ExePath(uint pid) {
        IntPtr h = OpenProcess(0x1000, false, pid); if (h == IntPtr.Zero) return "";
        var sb = new StringBuilder(1024); int n = 1024; string r = QueryFullProcessImageName(h, 0, sb, ref n) ? sb.ToString() : "";
        CloseHandle(h); return r;
    }
    public static List<object[]> Windows(long selfPid) {
        var l = new List<object[]>(); IntPtr fg = GetForegroundWindow();
        EnumWindows(delegate(IntPtr h, IntPtr p) {
            if (!IsWindowVisible(h)) return true;
            if (GetWindow(h, 4) != IntPtr.Zero) return true; // owned
            int ex = GetWindowLong(h, -20);
            if ((ex & 0x80) != 0 && (ex & 0x40000) == 0) return true; // tool window
            int cloaked; DwmGetWindowAttribute(h, 14, out cloaked, 4); if (cloaked != 0) return true;
            int len = GetWindowTextLength(h); if (len == 0) return true;
            var sb = new StringBuilder(len + 1); GetWindowText(h, sb, len + 1);
            uint pid; GetWindowThreadProcessId(h, out pid); if (pid == selfPid) return true;
            string exe = ExePath(pid);
            if (exe.EndsWith("TextInputHost.exe", StringComparison.OrdinalIgnoreCase)) return true;
            l.Add(new object[] { h.ToInt64(), sb.ToString(), (long)pid, exe, h == fg, IsIconic(h) });
            return true; }, IntPtr.Zero);
        return l;
    }
    public static void Focus(long hwnd, bool toggle) {
        IntPtr h = new IntPtr(hwnd);
        if (toggle && GetForegroundWindow() == h && !IsIconic(h)) { ShowWindow(h, 6); return; }
        if (IsIconic(h)) ShowWindow(h, 9);
        keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero); // unlocks SetForegroundWindow
        SetForegroundWindow(h);
    }
    public static void CloseWin(long hwnd) { PostMessage(new IntPtr(hwnd), 0x0010, IntPtr.Zero, IntPtr.Zero); }
    public static void Key(int vk) { keybd_event((byte)vk, 0, 0, UIntPtr.Zero); keybd_event((byte)vk, 0, 2, UIntPtr.Zero); }

    // ---------- Foreground + idle (screen time) ----------
    [StructLayout(LayoutKind.Sequential)] struct LASTINPUT { public uint cb; public uint time; }
    [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUT li);
    public static object[] Foreground() {
        var li = new LASTINPUT(); li.cb = 8; GetLastInputInfo(ref li);
        long idle = (Environment.TickCount - li.time) & 0xFFFFFFFF;
        IntPtr h = GetForegroundWindow(); uint pid; GetWindowThreadProcessId(h, out pid);
        int len = GetWindowTextLength(h); var sb = new StringBuilder(len + 1); GetWindowText(h, sb, len + 1);
        return new object[] { ExePath(pid), sb.ToString(), idle };
    }

    // ---------- fullscreen foreground app (games, videos) ----------
    [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint flags; }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);
    // Monitors whose top window is full screen, as flat [l,t,r,b, l,t,r,b, ...]. Per monitor, not just the
    // foreground window: a video stays full screen on one display while you click on another.
    public static int ParentPid = 0;
    // powershell.exe is DPI-unaware: on scaled monitors Windows would report window and monitor rects in
    // virtual 96-DPI pixels, which never match Electron's physical ones. Per-monitor v2 gives real pixels.
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
    public static void InitDpi() { try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { } }
    // Windows 11 does not round frameless (custom title bar) windows on its own: ask DWM for round corners
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int v, int size);
    public static void RoundCorners(long h) { int round = 2; DwmSetWindowAttribute(new IntPtr(h), 33, ref round, 4); }
    public static int[] FullscreenFg() {
        // Windows 10 tablet mode shows every app maximized without a caption: that is not full screen
        try { object tm = Microsoft.Win32.Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\ImmersiveShell", "TabletMode", 0); if (tm is int && (int)tm == 1) return new int[0]; } catch { }
        var mons = new List<RECT>();
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr hm, IntPtr dc, IntPtr pr, IntPtr d) {
            var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
            if (GetMonitorInfo(hm, ref mi)) mons.Add(mi.rcMonitor); return true; }, IntPtr.Zero);
        var done = new bool[mons.Count]; var res = new List<int>(); int left = mons.Count;
        EnumWindows(delegate(IntPtr h, IntPtr p) { // top of the z-order first
            if (left == 0) return false;
            if (!IsWindowVisible(h) || IsIconic(h)) return true;
            int cloaked; if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
            uint pid; GetWindowThreadProcessId(h, out pid); if (ParentPid != 0 && pid == ParentPid) return true; // our docks
            int ex = GetWindowLong(h, -20); if ((ex & 0x80) != 0 || (ex & 0x20) != 0) return true; // tool windows, click-through overlays
            RECT r; if (!GetWindowRect(h, out r) || r.r - r.l < 2 || r.b - r.t < 2) return true;
            var cls = new StringBuilder(64); GetClassName(h, cls, 64); string c = cls.ToString();
            bool shell = c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd";
            // a maximized window also covers the whole monitor when no taskbar or dock reserves space - that is not
            // full screen. Browsers stay "zoomed" in full screen (YouTube, F11) but drop caption and sizing frame.
            int st = GetWindowLong(h, -16);
            bool framedMax = IsZoomed(h) && ((st & 0xC00000) == 0xC00000 || (st & 0x40000) != 0);
            for (int i = 0; i < mons.Count; i++) {
                if (done[i]) continue; var m = mons[i];
                if (r.r <= m.l || r.l >= m.r || r.b <= m.t || r.t >= m.b) continue;
                bool covers = r.l <= m.l && r.t <= m.t && r.r >= m.r && r.b >= m.b;
                if (!covers && (ex & 0x8) != 0) continue; // small always-on-top windows (picture-in-picture …) float above
                done[i] = true; left--;
                if (covers && !shell && !framedMax) { res.Add(m.l); res.Add(m.t); res.Add(m.r); res.Add(m.b); }
            }
            return true; }, IntPtr.Zero);
        return res.ToArray();
    }

    // Pushes {"event":"fullscreen"} lines when the answer changes: driven by foreground, move/resize and
    // minimize events (debounced), so the dock steps aside without waiting for the next poll.
    public static TextWriter Out; static readonly object OutLock = new object();
    public static void Emit(string line) { lock (OutLock) { Out.WriteLine(line); } }
    static WinEventProc _fsProc; static System.Threading.AutoResetEvent _fsKick = new System.Threading.AutoResetEvent(true);
    static string _fsLast = null;
    public static void WatchFullscreen() {
        if (_fsProc != null) return;
        _fsProc = new WinEventProc(delegate(IntPtr hk, uint ev, IntPtr hwnd, int idObject, int idChild, uint th, uint tm) {
            if (idObject == 0 && idChild == 0) _fsKick.Set(); });
        var hooks = new System.Threading.Thread(delegate() {
            SetWinEventHook(0x0003, 0x0003, IntPtr.Zero, _fsProc, 0, 0, 0x0002);  // foreground
            SetWinEventHook(0x0016, 0x0017, IntPtr.Zero, _fsProc, 0, 0, 0x0002);  // minimize start/end
            SetWinEventHook(0x800B, 0x800B, IntPtr.Zero, _fsProc, 0, 0, 0x0002);  // location change
            SetWinEventHook(0x8002, 0x8003, IntPtr.Zero, _fsProc, 0, 0, 0x0002);  // show/hide
            MSG m; while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) { }
        });
        hooks.IsBackground = true; hooks.Start();
        var worker = new System.Threading.Thread(delegate() {
            while (true) {
                _fsKick.WaitOne(3000);           // also re-checks every 3 s in case an event was missed
                System.Threading.Thread.Sleep(40); // let a burst of events (window going full screen) settle
                _fsKick.Reset();
                string s; try { s = String.Join(",", Array.ConvertAll(FullscreenFg(), x => x.ToString())); } catch { continue; }
                if (s == _fsLast) continue; _fsLast = s;
                Emit("{\"event\":\"fullscreen\",\"rects\":[" + s + "]}");
            }
        });
        worker.IsBackground = true; worker.Start();
    }

    // ---------- Windows taskbar ----------
    public static bool TbHidden;
    // exits this helper (and gives the taskbar back) as soon as PrismDock is gone, even after a crash
    public static void WatchParent(int pid) {
        var t = new System.Threading.Thread(delegate() {
            while (true) {
                bool alive; try { alive = !Process.GetProcessById(pid).HasExited; } catch { alive = false; }
                if (!alive) { if (TbHidden) Taskbar(true); Process.GetCurrentProcess().Kill(); }
                System.Threading.Thread.Sleep(1500);
            }
        });
        t.IsBackground = true; t.Start();
        // PowerShell keeps transient objects of every request (JSON, WinRT media snapshots, icons) until the
        // next gen-2 collection; collecting and compacting every 2 minutes keeps the long-running helper small.
        _gcTimer = new System.Threading.Timer(delegate(object o) {
            System.Runtime.GCSettings.LargeObjectHeapCompactionMode = System.Runtime.GCLargeObjectHeapCompactionMode.CompactOnce;
            GC.Collect(2, GCCollectionMode.Forced, true, true);
        }, null, 30000, 120000);
    }
    static System.Threading.Timer _gcTimer;
    public static int OrigTbState = -1;
    static int TbState(IntPtr tb) { var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(typeof(APPBARDATA)); d.hWnd = tb; return (int)SHAppBarMessage(4, ref d); }
    static void SetTbState(IntPtr tb, int st) { var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(typeof(APPBARDATA)); d.hWnd = tb; d.lParam = (IntPtr)st; SHAppBarMessage(10, ref d); }
    public static bool TbSecondary = true;
    // monitors (physical rects) that have a PrismDock; only their taskbars are replaced. null = all.
    static List<int[]> DockMonitors = null;
    public static void SetDockMonitors(int[] flat) {
        if (flat == null || flat.Length < 4) { DockMonitors = null; return; }
        var l = new List<int[]>(); for (int i = 0; i + 3 < flat.Length; i += 4) l.Add(new int[] { flat[i], flat[i + 1], flat[i + 2], flat[i + 3] });
        DockMonitors = l;
    }
    [StructLayout(LayoutKind.Sequential)] struct PT { public int x, y; }
    [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(PT p, uint flags);
    // The monitor a taskbar belongs to. MonitorFromWindow is wrong for an auto-hidden taskbar: it slides
    // off its monitor and can lie mostly on the neighbouring one (e.g. a bottom taskbar of a monitor above
    // the main one). The own monitor keeps the visible sliver, so with two candidates the smaller overlap wins.
    static RECT TaskbarMonitor(IntPtr hwnd) {
        var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
        RECT w; if (!GetWindowRect(hwnd, out w) || w.r <= w.l || w.b <= w.t) { GetMonitorInfo(MonitorFromWindow(hwnd, 2), ref mi); return mi.rcMonitor; }
        var seen = new List<IntPtr>(); bool found = false; RECT best = new RECT(); long bestArea = long.MaxValue;
        int[][] pts = { new[] { w.l + 1, w.t + 1 }, new[] { w.r - 2, w.t + 1 }, new[] { w.l + 1, w.b - 2 }, new[] { w.r - 2, w.b - 2 }, new[] { (w.l + w.r) / 2, (w.t + w.b) / 2 } };
        foreach (var p in pts) {
            var pt = new PT(); pt.x = p[0]; pt.y = p[1];
            IntPtr m = MonitorFromPoint(pt, 0); if (m == IntPtr.Zero || seen.Contains(m)) continue; seen.Add(m);
            if (!GetMonitorInfo(m, ref mi)) continue; var r = mi.rcMonitor;
            long iw = Math.Min(w.r, r.r) - Math.Max(w.l, r.l), ih = Math.Min(w.b, r.b) - Math.Max(w.t, r.t);
            if (iw <= 0 || ih <= 0) continue; long area = iw * ih;
            if (area < bestArea) { bestArea = area; best = r; found = true; }
        }
        if (!found) { GetMonitorInfo(MonitorFromWindow(hwnd, 2), ref mi); return mi.rcMonitor; }
        return best;
    }
    static bool OnDockMonitor(IntPtr hwnd) {
        if (DockMonitors == null) return true;
        var mi = new MONITORINFO(); mi.rcMonitor = TaskbarMonitor(hwnd);
        foreach (var r in DockMonitors) if (Math.Abs(r[0] - mi.rcMonitor.l) < 4 && Math.Abs(r[1] - mi.rcMonitor.t) < 4 && Math.Abs(r[2] - mi.rcMonitor.r) < 4 && Math.Abs(r[3] - mi.rcMonitor.b) < 4) return true;
        return false;
    }
    static bool ShouldHide(IntPtr hwnd) { return TbHidden && OnDockMonitor(hwnd); }
    static void ShowTaskbarWindows(bool show) {
        IntPtr t = FindWindow("Shell_TrayWnd", null); if (t != IntPtr.Zero) ShowWindow(t, !show && ShouldHide(t) ? 0 : 5);
        IntPtr s = IntPtr.Zero;
        while ((s = FindWindowEx(IntPtr.Zero, s, "Shell_SecondaryTrayWnd", null)) != IntPtr.Zero) ShowWindow(s, !show && ShouldHide(s) ? 0 : 5);
    }

    // ---- event-driven suppression: Explorer re-shows the taskbar on Start, restarts, wake, display changes.
    // A WinEvent hook on EVENT_OBJECT_SHOW hides it again before it is composited, instead of polling.
    delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr mod, WinEventProc proc, uint pid, uint tid, uint flags);
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr h; public uint msg; public IntPtr w, l; public uint time; public int x, y; }
    [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint a, uint b);
    static WinEventProc _hookProc; static System.Threading.Thread _hookThread;
    public static int Rehides = 0;
    static long _burstUntil = 0;
    static void Burst() {
        bool start = (DateTime.UtcNow.Ticks / 10000) > _burstUntil;
        _burstUntil = (DateTime.UtcNow.Ticks / 10000) + 3000;
        if (!start) return;
        var t = new System.Threading.Thread(delegate() { while ((DateTime.UtcNow.Ticks / 10000) < _burstUntil) { EnsureHidden(); System.Threading.Thread.Sleep(8); } });
        t.IsBackground = true; t.Start();
    }
    public static void StartHook() {
        if (_hookThread != null) return;
        _hookThread = new System.Threading.Thread(delegate() {
            _hookProc = new WinEventProc(OnWinEvent);
            // EVENT_OBJECT_CREATE..EVENT_OBJECT_SHOW, out of context, skip our own process
            SetWinEventHook(0x8000, 0x8002, IntPtr.Zero, _hookProc, 0, 0, 0x0000 | 0x0002);
            MSG m; while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) { }
        });
        _hookThread.IsBackground = true; _hookThread.Start();
    }
    static void OnWinEvent(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time) {
        if (!TbHidden || idObject != 0 || hwnd == IntPtr.Zero) return;
        var cls = new StringBuilder(32); GetClassName(hwnd, cls, 32); string c = cls.ToString();
        if (c != "Shell_TrayWnd" && c != "Shell_SecondaryTrayWnd") return;
        if (!ShouldHide(hwnd)) return;
        ShowWindow(hwnd, 0);
        if (ev == 0x8000) Burst(); // a new Explorer is building its taskbar: it re-shows it several times while starting
        if (c == "Shell_TrayWnd" && (TbState(hwnd) & 1) == 0) SetTbState(hwnd, TbState(hwnd) | 1); // a new Explorer reads auto-hide again
        System.Threading.Interlocked.Increment(ref Rehides);
    }
    // Hide: switch the taskbar to auto-hide (Windows then frees the work area it reserves, so
    // maximized windows use the full height) and hide its windows on every monitor.
    // Show: restore the original auto-hide setting and the windows. Returns the original state.
    public static int Taskbar(bool show, int restoreState) {
        IntPtr t = FindWindow("Shell_TrayWnd", null);
        if (!show) {
            if (!TbHidden && t != IntPtr.Zero) OrigTbState = restoreState >= 0 ? restoreState : TbState(t);
            TbHidden = true;
            // auto-hide is a single setting for all taskbars; it must be on so hidden taskbars free their work area
            if (t != IntPtr.Zero && (TbState(t) & 1) == 0) SetTbState(t, TbState(t) | 1);
            ShowTaskbarWindows(false);
            StartHook();
            return OrigTbState;
        }
        int st = restoreState >= 0 ? restoreState : OrigTbState;
        if (t != IntPtr.Zero && st >= 0) SetTbState(t, st);
        TbHidden = false; OrigTbState = -1;
        ShowTaskbarWindows(true);
        return st;
    }
    public static void Taskbar(bool show) { Taskbar(show, -1); }
    public static int[] TbInfo() { IntPtr t = FindWindow("Shell_TrayWnd", null); return new int[] { t != IntPtr.Zero && IsWindowVisible(t) ? 1 : 0, t != IntPtr.Zero ? TbState(t) : -1 }; }
    // Explorer brings the taskbar back on some events (Start menu, Explorer restart, display changes).
    public static bool EnsureHidden() {
        if (!TbHidden) return false;
        bool fixedAny = false;
        IntPtr t = FindWindow("Shell_TrayWnd", null);
        if (t != IntPtr.Zero) {
            if ((TbState(t) & 1) == 0) { SetTbState(t, TbState(t) | 1); fixedAny = true; }
            bool hideT = ShouldHide(t);
            if (hideT && IsWindowVisible(t)) { ShowWindow(t, 0); fixedAny = true; }
            if (!hideT && !IsWindowVisible(t)) ShowWindow(t, 5);
        }
        IntPtr s = IntPtr.Zero;
        while ((s = FindWindowEx(IntPtr.Zero, s, "Shell_SecondaryTrayWnd", null)) != IntPtr.Zero) {
            bool hide = ShouldHide(s);
            if (hide && IsWindowVisible(s)) { ShowWindow(s, 0); fixedAny = true; }
            if (!hide && !IsWindowVisible(s)) ShowWindow(s, 5);
        }
        return fixedAny;
    }

    // ---------- taskbar guardian: a process outside PrismDock's job object ----------
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct STARTUPINFO { public int cb; public string r, d, t; public int x, y, w, h, cx, cy, fill, flags; public short show, r2; public IntPtr r3, i, o, e; }
    [StructLayout(LayoutKind.Sequential)] struct PROCINFO { public IntPtr hp, ht; public int pid, tid; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcess(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string dir, ref STARTUPINFO si, out PROCINFO pi);
    public static int SpawnDetached(string cmdline) {
        var si = new STARTUPINFO(); si.cb = Marshal.SizeOf(typeof(STARTUPINFO)); PROCINFO pi;
        // CREATE_BREAKAWAY_FROM_JOB | CREATE_NO_WINDOW: survives PrismDock's job object being closed
        bool ok = CreateProcess(null, new StringBuilder(cmdline), IntPtr.Zero, IntPtr.Zero, false, 0x01000000 | 0x08000000, IntPtr.Zero, null, ref si, out pi);
        if (!ok) ok = CreateProcess(null, new StringBuilder(cmdline), IntPtr.Zero, IntPtr.Zero, false, 0x08000000, IntPtr.Zero, null, ref si, out pi);
        if (!ok) return -Marshal.GetLastWin32Error();
        CloseHandle(pi.hp); CloseHandle(pi.ht); return pi.pid;
    }

    // ---------- AppBar (reserve screen space) ----------
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int l, t, r, b; }
    [StructLayout(LayoutKind.Sequential)] public struct APPBARDATA { public int cbSize; public IntPtr hWnd; public uint msg; public uint edge; public RECT rc; public IntPtr lParam; }
    [DllImport("shell32.dll")] static extern UIntPtr SHAppBarMessage(uint msg, ref APPBARDATA d);
    public static int[] AppBar(long hwnd, bool on, int edge, int l, int t, int r, int b) {
        var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(typeof(APPBARDATA)); d.hWnd = new IntPtr(hwnd);
        if (!on) { SHAppBarMessage(1, ref d); return new int[0]; }
        d.msg = 0x8123; SHAppBarMessage(0, ref d); // ABM_NEW (ignored if already registered)
        d.edge = (uint)edge; d.rc.l = l; d.rc.t = t; d.rc.r = r; d.rc.b = b;
        SHAppBarMessage(2, ref d); // QUERYPOS
        if (edge == 3) d.rc.t = d.rc.b - (b - t); else d.rc.b = d.rc.t + (b - t);
        SHAppBarMessage(3, ref d); // SETPOS
        return new int[] { d.rc.l, d.rc.t, d.rc.r, d.rc.b };
    }

    // ---------- High resolution shell icons ----------
    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItemImageFactory { [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr bmp); }
    [StructLayout(LayoutKind.Sequential)] struct SIZE { public int cx, cy; public SIZE(int x, int y) { cx = x; cy = y; } }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName(string path, IntPtr ctx, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory f);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
    [StructLayout(LayoutKind.Sequential)] struct BITMAP { public int type, width, height, widthBytes; public ushort planes, bpp; public IntPtr bits; }
    [DllImport("gdi32.dll")] static extern int GetObject(IntPtr h, int n, out BITMAP b);
    public static string Icon(string path, int size) {
        IShellItemImageFactory f;
        SHCreateItemFromParsingName(path, IntPtr.Zero, new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), out f);
        IntPtr hb; if (f.GetImage(new SIZE(size, size), 0x1 /* BIGGERSIZEOK */, out hb) != 0) return null;
        try {
            BITMAP bm; GetObject(hb, Marshal.SizeOf(typeof(BITMAP)), out bm);
            using (var bmp = new Bitmap(bm.width, bm.height, PixelFormat.Format32bppArgb)) {
                var data = bmp.LockBits(new Rectangle(0, 0, bm.width, bm.height), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
                int stride = bm.widthBytes; var buf = new byte[stride * bm.height];
                Marshal.Copy(bm.bits, buf, 0, buf.Length);
                bool hasAlpha = false; for (int i = 3; i < buf.Length; i += 4) if (buf[i] != 0) { hasAlpha = true; break; }
                if (!hasAlpha) for (int i = 3; i < buf.Length; i += 4) buf[i] = 255;
                // DIB sections are bottom-up when height is positive
                for (int y = 0; y < bm.height; y++) Marshal.Copy(buf, (bm.height - 1 - y) * stride, data.Scan0 + y * data.Stride, Math.Min(stride, data.Stride));
                bmp.UnlockBits(data);
                using (var ms = new MemoryStream()) { bmp.Save(ms, ImageFormat.Png); return Convert.ToBase64String(ms.ToArray()); }
            }
        } finally { DeleteObject(hb); }
    }
}
"@
Add-Type -TypeDefinition $src -ReferencedAssemblies System.Drawing -Language CSharp
[void][PD]::Cpu()
[PD]::InitDpi()
[PD]::Out = $script:stdout
if ($env:PRISM_PARENT_PID) { [PD]::ParentPid = [int]$env:PRISM_PARENT_PID; [PD]::WatchParent([int]$env:PRISM_PARENT_PID) }

# ---------- WinRT helpers ----------
$asTaskOp = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
$script:asStream = [System.IO.WindowsRuntimeStreamExtensions].GetMethods() | Where-Object { $_.Name -eq "AsStreamForRead" -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1
# a WinRT call that never completes (frozen media player) must not block the helper: .Result would wait forever
function Await($op, [Type]$t) { $task = $asTaskOp.MakeGenericMethod($t).Invoke($null, @($op)); if (-not $task.Wait(4000)) { throw 'Windows did not answer in time' }; $task.Result }

$script:mediaMgr = $null
$script:thumbKey = ''
$script:thumbSeq = 0
$script:thumbFile = $null
$script:thumbTries = 0
$script:thumbData = $null
function Get-MediaSession {
    if (-not $script:mediaMgr) {
        [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
        $script:mediaMgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    }
    $script:mediaMgr.GetCurrentSession()
}
function Get-Media($dir) {
    $s = Get-MediaSession
    if (-not $s) { return @{ active = $false } }
    $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $info = $s.GetPlaybackInfo(); $tl = $s.GetTimelineProperties()
    $key = "$($s.SourceAppUserModelId)|$($p.Title)|$($p.Artist)"
    if ($key -ne $script:thumbKey) { $script:thumbKey = $key; $script:thumbFile = $null; $script:thumbTries = 0 }
    # players often publish the cover a moment after the title - keep trying for a few polls
    if (-not $script:thumbFile -and $p.Thumbnail -and $dir -and $script:thumbTries -lt 12) {
        $script:thumbTries++
        try {
            [void][Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
            $st = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
            $net = $script:asStream.Invoke($null, @($st))
            $ms = New-Object System.IO.MemoryStream; $net.CopyTo($ms); $net.Dispose()
            if ($ms.Length -gt 0) {
                $script:thumbSeq++
                $name = 'cover-' + $script:thumbSeq + '.img'
                [System.IO.File]::WriteAllBytes((Join-Path $dir $name), $ms.ToArray())
                $old = Get-ChildItem -LiteralPath $dir -Filter 'cover-*.img' | Where-Object { $_.Name -ne $name }
                $old | Remove-Item -ErrorAction SilentlyContinue
                $script:thumbFile = $name
            }
        } catch { }
    }
    $c = $info.Controls
    @{
        active = $true; app = $s.SourceAppUserModelId; title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle
        status = [string]$info.PlaybackStatus; position = $tl.Position.TotalSeconds; duration = $tl.EndTime.TotalSeconds
        start = $tl.StartTime.TotalSeconds
        updated = ([DateTimeOffset]$tl.LastUpdatedTime).ToUnixTimeMilliseconds(); cover = $script:thumbFile
        canNext = $c.IsNextEnabled; canPrev = $c.IsPreviousEnabled; canSeek = $c.IsPlaybackPositionEnabled; canToggle = $c.IsPlayPauseToggleEnabled
        shuffle = $info.IsShuffleActive; repeat = [string]$info.AutoRepeatMode
    }
}
function Invoke-MediaCmd($action, $pos) {
    $s = Get-MediaSession; if (-not $s) { return $false }
    switch ($action) {
        'toggle' { $op = $s.TryTogglePlayPauseAsync() }
        'next' { $op = $s.TrySkipNextAsync() }
        'prev' { $op = $s.TrySkipPreviousAsync() }
        'seek' { $op = $s.TryChangePlaybackPositionAsync([long]($pos * 10000000)) }
    }
    Await $op ([bool])
}

$script:radiosReady = $false
function Get-Radios {
    if (-not $script:radiosReady) {
        [void][Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime]
        [void](Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus]))
        $script:radiosReady = $true
    }
    Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
}

function Get-Wifi {
    $out = netsh wlan show interfaces 2>$null
    $r = @{ connected = $false; ssid = ''; signal = 0; rate = '' }
    foreach ($l in $out) {
        if ($l -match '^\s*SSID\s*:\s*(.+)$') { $r.ssid = $Matches[1].Trim() }
        elseif ($l -match '^\s*(Signal|Signalqualit\S*)\s*:\s*(\d+)\s*%') { $r.signal = [int]$Matches[2] }
        elseif ($l -match '^\s*(State|Status)\s*:\s*(connected|verbunden)') { $r.connected = $true }
        elseif ($l -match '^\s*(Receive rate|Empfangsrate)[^:]*:\s*(.+)$') { $r.rate = $Matches[2].Trim() }
    }
    $r
}

function Invoke-Cmd($cmd, $a) {
    switch ($cmd) {
        'ping' { 'pong' }
        'cpu' { [PD]::Cpu() }
        'mem' { $m = [PD]::Mem(); @{ total = $m[0]; free = $m[1] } }
        'battery' { $b = [PD]::Battery(); @{ ac = $b[0]; flag = $b[1]; percent = $b[2]; saver = $b[3]; secondsLeft = $b[4] } }
        'net' { $n = [PD]::Net(); @{ rx = $n[0]; tx = $n[1] } }
        'gpu' { [PD]::Gpu() }
        'thermal' { , ([PD]::Thermal()) }
        'disks' { , @([PD]::Disks() | ForEach-Object { @{ name = $_[0]; label = $_[1]; total = $_[2]; free = $_[3] } }) }
        'recycle' { $r = [PD]::Recycle(); @{ items = $r[0]; size = $r[1] } }
        'recycleEmpty' { [PD]::EmptyRecycle() }
        'volume' { $v = [PD]::GetVolume(0); $m = [PD]::GetVolume(1); @{ level = $v[0]; muted = $v[1]; device = $v[2]; deviceId = $v[3]; micLevel = $m[0]; micMuted = $m[1]; mic = $m[2] } }
        'setVolume' { [PD]::SetVolume([int]$a.flow, [double]$a.level); $true }
        'setMute' { [PD]::SetMute([int]$a.flow, [bool]$a.muted); $true }
        'audioDevices' { @{ output = @([PD]::Devices(0) | ForEach-Object { @{ id = $_[0]; name = $_[1]; isDefault = $_[2] } }); input = @([PD]::Devices(1) | ForEach-Object { @{ id = $_[0]; name = $_[1]; isDefault = $_[2] } }) } }
        'setDefaultDevice' { [PD]::SetDefaultDevice([string]$a.id) }
        'audioSessions' { , @([PD]::Sessions() | ForEach-Object { @{ id = $_[0]; name = $_[1]; exe = $_[2]; pid = $_[3]; volume = $_[4]; muted = $_[5]; active = $_[6]; system = $_[7] } }) }
        'setSession' { [PD]::SetSession([string]$a.id, [double]$a.volume, [int]$a.mute) }
        'brightness' {
            $v = -1; $kind = 'none'
            try { $w = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1; if ($w) { $v = [int]$w.CurrentBrightness; $kind = 'internal' } } catch {}
            if ($v -lt 0) { $v = [PD]::DdcGet(); if ($v -ge 0) { $kind = 'ddc' } }
            @{ level = $v; kind = $kind }
        }
        'setBrightness' {
            $ok = $false
            try { $m = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1; if ($m) { [void](Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = [byte]$a.level }); $ok = $true } } catch {}
            if (-not $ok) { $ok = [PD]::DdcSet([int]$a.level) }
            $ok
        }
        'windows' { , @([PD]::Windows([long]$a.selfPid) | ForEach-Object { @{ hwnd = $_[0]; title = $_[1]; pid = $_[2]; exe = $_[3]; active = $_[4]; minimized = $_[5] } }) }
        'focus' { [PD]::Focus([long]$a.hwnd, [bool]$a.toggle); $true }
        'round' { [PD]::RoundCorners([long]$a.hwnd); $true }
        'closeWindow' { [PD]::CloseWin([long]$a.hwnd); $true }
        'key' { [PD]::Key([int]$a.vk); $true }
        'foreground' { $f = [PD]::Foreground(); @{ exe = $f[0]; title = $f[1]; idleMs = $f[2] } }
        'taskbar' { if ($null -ne $a.monitors) { [PD]::SetDockMonitors([int[]]@($a.monitors)) }; $r = if ($null -ne $a.restore) { [int]$a.restore } else { -1 }; [PD]::Taskbar([bool]$a.show, $r) }
        'guard' {
            # compile guard.cs once per version (the file name carries a hash of the source)
            $exe = [string]$a.exe
            if (-not (Test-Path -LiteralPath $exe)) { Add-Type -TypeDefinition ([IO.File]::ReadAllText([string]$a.source)) -OutputAssembly $exe -OutputType WindowsApplication }
            [PD]::SpawnDetached('"' + $exe + '" ' + [int]$a.pid + ' "' + [string]$a.file + '"')
        }
        'tbInfo' { $i = [PD]::TbInfo(); @{ visible = [bool]$i[0]; state = $i[1] } }
        'fswatch' { [PD]::WatchFullscreen(); $true }
        'volwatch' { [PD]::WatchVolume(); $true }
        'tick' { @{ taskbarFixed = [PD]::EnsureHidden(); rehides = [PD]::Rehides } }
        'fullscreen' { , ([PD]::FullscreenFg()) }
        'appbar' { , ([PD]::AppBar([long]$a.hwnd, [bool]$a.on, [int]$a.edge, [int]$a.l, [int]$a.t, [int]$a.r, [int]$a.b)) }
        'icon' { [PD]::Icon([string]$a.path, [int]$a.size) }
        # a failed WinRT call can leave a stale session manager behind: ask for a fresh one next time
        'media' { try { Get-Media ([string]$a.dir) } catch { $script:mediaMgr = $null; throw } }
        'mediaCmd' { try { Invoke-MediaCmd $a.action $a.position } catch { $script:mediaMgr = $null; throw } }
        'radios' { , @(Get-Radios | ForEach-Object { @{ name = $_.Name; kind = [string]$_.Kind; state = [string]$_.State } }) }
        'setRadio' {
            $r = Get-Radios | Where-Object { [string]$_.Kind -eq $a.kind } | Select-Object -First 1
            if (-not $r) { return $false }
            $st = if ($a.on) { [Windows.Devices.Radios.RadioState]::On } else { [Windows.Devices.Radios.RadioState]::Off }
            [string](Await ($r.SetStateAsync($st)) ([Windows.Devices.Radios.RadioAccessStatus]))
        }
        'wifi' { Get-Wifi }
        'shortcut' { $sh = New-Object -ComObject WScript.Shell; $l = $sh.CreateShortcut([string]$a.path); @{ target = $l.TargetPath; args = $l.Arguments; icon = $l.IconLocation } }
        'wallpaper' {
            $k = Get-ItemProperty 'HKCU:\Control Panel\Desktop'
            $p = $k.WallPaper
            $cached = Join-Path $env:APPDATA 'Microsoft\Windows\Themes\TranscodedWallpaper'
            if (-not $p -or -not (Test-Path $p)) { $p = $cached }
            $color = (Get-ItemProperty 'HKCU:\Control Panel\Colors' -ErrorAction SilentlyContinue).Background
            @{ path = $p; style = [string]$k.WallpaperStyle; tile = [string]$k.TileWallpaper; color = $color; mtime = (Get-Item $p -ErrorAction SilentlyContinue).LastWriteTime.Ticks }
        }
        default { throw "unknown command $cmd" }
    }
}

[PD]::Emit('{"ready":true}')
try {
    while ($true) {
        $line = $script:stdin.ReadLine()
        if ($null -eq $line) { break }
        if (-not $line.Trim()) { continue }
        $req = $null
        try {
            $req = $line | ConvertFrom-Json
            $res = Invoke-Cmd $req.cmd $req.args
            $out = @{ id = $req.id; ok = $true; result = $res }
        } catch {
            $out = @{ id = $(if ($req) { $req.id } else { 0 }); ok = $false; error = $_.Exception.Message }
        }
        [PD]::Emit(($out | ConvertTo-Json -Compress -Depth 6))
    }
} catch {
    # stdin/stdout pipe broke because PrismDock exited or crashed
} finally {
    # PrismDock went away (quit or crash): never leave the Windows taskbar hidden
    if ([PD]::TbHidden) { [void][PD]::Taskbar($true, -1) }
}

