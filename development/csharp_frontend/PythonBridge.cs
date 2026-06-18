using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Threading.Tasks;

namespace DimaCaeApp
{
    public class PythonBridge : IDisposable
    {
        private Process _pythonProcess;
        private TcpClient _client;
        private NetworkStream _stream;
        private readonly string _pythonPath;
        private readonly string _scriptPath;
        private readonly int _port;

        public PythonBridge(string pythonPath, string scriptPath, int port = 65432)
        {
            _pythonPath = pythonPath;
            _scriptPath = scriptPath;
            _port = port;
        }

        /// <summary>
        /// Launches the Python backend process and connects to its server.
        /// </summary>
        public async Task StartAsync()
        {
            // Start the Python process
            _pythonProcess = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = _pythonPath,
                    Arguments = $"\"{_scriptPath}\" --port {_port}",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                }
            };

            _pythonProcess.Start();

            // Attempt to connect via socket
            int retries = 5;
            while (retries > 0)
            {
                try
                {
                    _client = new TcpClient();
                    await _client.ConnectAsync("127.0.0.1", _port);
                    _stream = _client.GetStream();
                    break;
                }
                catch (SocketException)
                {
                    retries--;
                    await Task.Delay(500); // Wait for python server to boot
                }
            }

            if (_client == null || !_client.Connected)
            {
                throw new Exception("Failed to connect to Python backend server.");
            }
        }

        /// <summary>
        /// Sends JSON command to Python and receives JSON response.
        /// </summary>
        public async Task<string> SendRequestAsync(string jsonRequest)
        {
            if (_stream == null) throw new InvalidOperationException("Not connected to Python backend.");

            byte[] data = Encoding.UTF8.GetBytes(jsonRequest + "\n");
            await _stream.WriteAsync(data, 0, data.Length);
            await _stream.FlushAsync();

            // Read response (terminated by newline)
            using (var reader = new StreamReader(_stream, Encoding.UTF8, false, 1024, leaveOpen: true))
            {
                string response = await reader.ReadLineAsync();
                return response;
            }
        }

        public void Dispose()
        {
            _stream?.Dispose();
            _client?.Dispose();
            if (_pythonProcess != null && !_pythonProcess.HasExited)
            {
                _pythonProcess.Kill();
                _pythonProcess.Dispose();
            }
        }
    }
}
