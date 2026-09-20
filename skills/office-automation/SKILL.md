---
name: office-automation
description: Drive Microsoft Excel, Word and PowerPoint on this computer for real — create and edit workbooks with formulas and formatting, write documents with headings/tables/images, build slide decks, read existing files, export to PDF — through Office's own COM automation from run_command (Windows). Use whenever the user asks for a spreadsheet, a report, a deck, a .xlsx/.docx/.pptx, "open Excel and…", "put this in Word", or to read/update an existing Office file. Falls back to plain files when Office is not installed.
---

Office is scripted through its COM automation from PowerShell, which run_command already runs on
Windows. The result is the real application producing a real file — formulas calculate, styles
apply, the file opens in Office exactly as it would if a person had made it. Nothing to install.

The three recipes below are also in reference/excel.md, reference/word.md and reference/powerpoint.md
(use_skill with `file`). **Use PowerShell + COM as written. Do not switch to python/openpyxl/win32com** —
they may not be installed, and a command that printed nothing proves nothing.

Rules that keep it reliable:
- Check once per session: `Get-Command excel` is not enough — try `New-Object -ComObject Excel.Application`
  in a try/catch. If it fails, Office is not installed: write CSV / Markdown / HTML instead and say so.
- Always `$app.Visible = $false; $app.DisplayAlerts = $false`, always `Close`/`Quit` in a `finally`, and
  `ReleaseComObject` — a leaked Excel process keeps the file locked.
- Save with an explicit format code: xlsx `51`, xlsm `52`, docx `16` (wdFormatXMLDocument), pdf from Word
  `17`, pptx `24`, pdf from PowerPoint `32`. Paths must be absolute.
- Put the whole script in ONE run_command as a here-string (`@' … '@`), never line by line.
- Build content from real data: read the source (a CSV, the codebase, a web page) first; never invent
  numbers. If the user must supply a value, leave a clearly marked cell and tell them.
- Every script ends by printing something checkable (`"saved $out …"` plus a value read back). If the
  output is empty or shows an error, the file was NOT made — say so and fix it; never report success
  you did not see.
- When the file is written and checked, call **deliver_file** with its path and a one-line note: it
  becomes a card in the chat (Open · Show in folder) and stays in the history. Do this for every file
  you produce — workbook, document, deck, PDF, CSV.

## Excel — new workbook with data, formulas, formatting

```powershell
$out = "C:\Users\me\Documents\leads.xlsx"
$x = New-Object -ComObject Excel.Application; $x.Visible = $false; $x.DisplayAlerts = $false
try {
  $wb = $x.Workbooks.Add(); $ws = $wb.Worksheets.Item(1); $ws.Name = "Leads"
  $rows = @(@("Company","Contact","Title","Score"), @("Acme","Ravi","CTO",82), @("Globex","Priya","Head of Eng",74))
  for ($r=0; $r -lt $rows.Count; $r++) { for ($c=0; $c -lt $rows[$r].Count; $c++) { $ws.Cells.Item($r+1,$c+1) = $rows[$r][$c] } }
  $ws.Cells.Item($rows.Count+1, 4).Formula = "=AVERAGE(D2:D$($rows.Count))"
  $ws.Range("A1:D1").Font.Bold = $true
  $ws.Range("A1:D1").Interior.Color = 0xEEEEEE            # BGR as int; 0xEEEEEE = light grey
  $ws.Columns.Item("A:D").AutoFit() | Out-Null
  $ws.ListObjects.Add(1, $ws.Range("A1:D$($rows.Count)"), $null, 1) | Out-Null   # a real table
  $wb.SaveAs($out, 51)
  "saved $out avg=" + $ws.Cells.Item($rows.Count+1,4).Value2
} finally { if ($wb) { $wb.Close($false) }; $x.Quit(); [Runtime.InteropServices.Marshal]::ReleaseComObject($x) | Out-Null }
```

Read an existing workbook: `$wb = $x.Workbooks.Open($path)`; a range to CSV-like text:
`$ws.UsedRange.Value2` (2-D array). Charts: `$ch = $ws.Shapes.AddChart2(201, 51).Chart; $ch.SetSourceData($ws.Range("A1:B10"))`
(51 = clustered column, 4 = line, 5 = pie). Number formats: `$ws.Range("D2:D50").NumberFormat = "#,##0.00"`.

## Word — a document with headings, paragraphs, a table, an image, export to PDF

```powershell
$out = "C:\Users\me\Documents\report.docx"
$w = New-Object -ComObject Word.Application; $w.Visible = $false; $w.DisplayAlerts = 0
try {
  $d = $w.Documents.Add(); $s = $w.Selection
  $s.Style = "Title"; $s.TypeText("Q3 Report"); $s.TypeParagraph()
  $s.Style = "Heading 1"; $s.TypeText("Summary"); $s.TypeParagraph()
  $s.Style = "Normal"; $s.TypeText("Revenue grew 24%, entirely from enterprise renewals."); $s.TypeParagraph()
  $t = $d.Tables.Add($s.Range, 3, 2); $t.Borders.Enable = $true
  $t.Cell(1,1).Range.Text = "Metric"; $t.Cell(1,2).Range.Text = "Value"
  $t.Cell(2,1).Range.Text = "Revenue"; $t.Cell(2,2).Range.Text = "₹4.2 Cr"
  $t.Cell(3,1).Range.Text = "Churn";   $t.Cell(3,2).Range.Text = "2.1%"
  $s.EndKey(6) | Out-Null; $s.TypeParagraph()
  # $s.InlineShapes.AddPicture("C:\path\chart.png") | Out-Null
  $d.SaveAs([ref]$out, [ref]16)
  $d.SaveAs([ref]($out -replace "\.docx$", ".pdf"), [ref]17)   # PDF beside it
  "saved $out words=" + $d.Words.Count
} finally { if ($d) { $d.Close(0) }; $w.Quit(); [Runtime.InteropServices.Marshal]::ReleaseComObject($w) | Out-Null }
```

Read a document's text: `$d = $w.Documents.Open($path); $d.Content.Text`. Find/replace:
`$f = $d.Content.Find; $f.Execute("{{name}}", $false, $false, $false, $false, $false, $true, 1, $false, "Ravi", 2)`.

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

## When to design instead

A document that is meant to *look* designed — a brochure, a proposal, a one-pager, a deck with a
visual world — is Design canvas work (kinds Document / Slide deck), which exports PDF and images.
Office automation is for files people will keep editing in Excel, Word or PowerPoint, and for data.
