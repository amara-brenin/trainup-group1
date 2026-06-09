$ErrorActionPreference = "Stop"
Get-ChildItem -Path "$PSScriptRoot\..\src" -Recurse -Filter *.js | ForEach-Object {
  node --check $_.FullName | Out-Null
}
