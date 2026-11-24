' Chay phan mem an (khong hien cua so) - dung cho tu khoi dong cung Windows.
' Nhat ky ghi vao data\server.log
Option Explicit
Dim fso, sh, dir
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
If Not fso.FolderExists(dir & "\data") Then fso.CreateFolder(dir & "\data")
If Not fso.FileExists(dir & "\config.env") Then fso.CopyFile dir & "\config.env.example", dir & "\config.env"
sh.Run "cmd /c node --disable-warning=ExperimentalWarning src\server.js >> data\server.log 2>&1", 0, False
