param(
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [Parameter(Mandatory = $true)][string]$FilePath
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;

public static class RawPrinterHelper
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DOCINFOW
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport("winspool.Drv", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern int StartDocPrinter(IntPtr hPrinter, int level, ref DOCINFOW pDocInfo);

    [DllImport("winspool.Drv", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

    public static string SendFile(string printerName, string filePath)
    {
        IntPtr hPrinter = IntPtr.Zero;
        DOCINFOW docInfo = new DOCINFOW();
        docInfo.pDocName = "Restaurant POS Receipt";
        docInfo.pOutputFile = null;
        docInfo.pDataType = "RAW";

        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
        {
            return "OpenPrinter failed: " + Marshal.GetLastWin32Error();
        }

        try
        {
            if (StartDocPrinter(hPrinter, 1, ref docInfo) == 0)
            {
                return "StartDocPrinter failed: " + Marshal.GetLastWin32Error();
            }

            try
            {
                if (!StartPagePrinter(hPrinter))
                {
                    return "StartPagePrinter failed: " + Marshal.GetLastWin32Error();
                }

                try
                {
                    byte[] bytes = File.ReadAllBytes(filePath);
                    int written;
                    if (!WritePrinter(hPrinter, bytes, bytes.Length, out written))
                    {
                        return "WritePrinter failed: " + Marshal.GetLastWin32Error();
                    }
                    if (written != bytes.Length)
                    {
                        return "WritePrinter wrote " + written + " of " + bytes.Length + " bytes";
                    }
                    return "OK";
                }
                finally
                {
                    EndPagePrinter(hPrinter);
                }
            }
            finally
            {
                EndDocPrinter(hPrinter);
            }
        }
        finally
        {
            ClosePrinter(hPrinter);
        }
    }
}
'@

$result = [RawPrinterHelper]::SendFile($PrinterName, $FilePath)
if ($result -ne 'OK') {
  [Console]::Error.WriteLine($result)
  exit 1
}

Write-Output 'OK'
