' Auto-inicio IZC: asegura el servidor y abre el navegador (sin consola).
' Funciona desde tools\ o desde la copia en Startup.
Option Explicit
Dim sh, fso, here, bat, candidates, i
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)

candidates = Array( _
  here & "\ABRIR.bat", _
  "C:\IZC Server\tools\ABRIR.bat", _
  "C:\IZC\tools\ABRIR.bat" _
)

bat = ""
For i = 0 To UBound(candidates)
  If fso.FileExists(candidates(i)) Then
    bat = candidates(i)
    Exit For
  End If
Next

If bat = "" Then
  MsgBox "No encuentro ABRIR.bat. Abre C:\IZC Server\ABRIR.bat", vbExclamation, "IZC"
  WScript.Quit 1
End If

' Breve espera al iniciar sesion para que Windows termine de cargar.
WScript.Sleep 2500
sh.Run """" & bat & """", 0, True
