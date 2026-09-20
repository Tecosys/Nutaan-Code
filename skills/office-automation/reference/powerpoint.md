# PowerPoint via COM

## PowerPoint — a deck from a list of slides

```powershell
$out = "C:\Users\me\Documents\deck.pptx"
$p = New-Object -ComObject PowerPoint.Application
try {
  $pres = $p.Presentations.Add(0)                        # 0 = msoFalse: no window
  $slides = @(@("Nutaan Code","Build, design, ship — one key"), @("The problem","Every tool needs its own setup"), @("Close","nutaan.com"))
  $i = 1
  foreach ($sl in $slides) {
    $layout = if ($i -eq 1) { 1 } else { 2 }               # 1 title, 2 title+content
    $s = $pres.Slides.Add($i, $layout)
    $s.Shapes.Item(1).TextFrame.TextRange.Text = $sl[0]
    $s.Shapes.Item(2).TextFrame.TextRange.Text = $sl[1]
    $i++
  }
  $pres.SaveAs($out, 24)
  "saved $out slides=" + $pres.Slides.Count
} finally { if ($pres) { $pres.Close() }; $p.Quit(); [Runtime.InteropServices.Marshal]::ReleaseComObject($p) | Out-Null }
```

PowerPoint's `Presentations.Add(0)` fails on some installs when no window is allowed; if it throws,
use `Add()` and set `$p.WindowState = 2` (minimised).
