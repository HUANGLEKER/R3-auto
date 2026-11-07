using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace R3Web
{
    static class Program
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        static extern IntPtr CreateJobObject(IntPtr attributes, string name);

        [DllImport("kernel32.dll")]
        static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);

        [DllImport("kernel32.dll")]
        static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [DllImport("kernel32.dll")]
        static extern bool CloseHandle(IntPtr handle);

        [StructLayout(LayoutKind.Sequential)]
        struct IO_COUNTERS
        {
            public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
            public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass, SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryLimit, PeakJobMemoryLimit;
        }

        [STAThread]
        static void Main()
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string nodeExe = Path.Combine(baseDir, @"node\node.exe");
            if (!File.Exists(nodeExe))
            {
                MessageBox.Show("未找到内置 Node.js 运行环境:\n" + nodeExe + "\n\n请确认 node\\node.exe 文件完整。",
                    "启动错误", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            string entryScript = Path.Combine(baseDir, @"src\web\main.ts");
            if (!File.Exists(entryScript))
            {
                MessageBox.Show("未找到本地 Web 服务入口文件:\n" + entryScript,
                    "启动错误", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            IntPtr job = CreateJobObject(IntPtr.Zero, null);
            if (job != IntPtr.Zero)
            {
                var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                // 0x2000 = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                // 0x0800 = JOB_OBJECT_LIMIT_BREAKAWAY_OK
                // 0x1000 = JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK (allows spawned browsers like Edge to remain open when launcher/console closes)
                limits.BasicLimitInformation.LimitFlags = 0x2000 | 0x0800 | 0x1000;
                int length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
                IntPtr memory = Marshal.AllocHGlobal(length);
                try
                {
                    Marshal.StructureToPtr(limits, memory, false);
                    if (!SetInformationJobObject(job, 9, memory, (uint)length))
                    {
                        CloseHandle(job);
                        job = IntPtr.Zero;
                    }
                }
                finally { Marshal.FreeHGlobal(memory); }
            }

            try
            {
                var start = new ProcessStartInfo(nodeExe, "\"src\\web\\main.ts\"");
                start.WorkingDirectory = baseDir;
                start.UseShellExecute = false;
                using (Process child = Process.Start(start))
                {
                    if (child == null) throw new InvalidOperationException("无法启动本地 Web 服务进程");
                    if (job != IntPtr.Zero) AssignProcessToJobObject(job, child.Handle);
                    child.WaitForExit();
                    if (child.ExitCode != 0)
                    {
                        MessageBox.Show(
                            "本地 Web 服务异常退出 (退出码: " + child.ExitCode + ")。\n\n" +
                            "排查建议：\n" +
                            "1. 可双击根目录下的【启动.bat】查看控制台详细报错；\n" +
                            "2. 检查默认端口 3000 是否被占用；\n" +
                            "3. 检查 data\\ 目录下的错误日志 (startup_error.log)。",
                            "服务已退出", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    }
                }
            }
            catch (Exception error)
            {
                MessageBox.Show(error.Message, "启动错误", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                if (job != IntPtr.Zero) CloseHandle(job);
            }
        }
    }
}
