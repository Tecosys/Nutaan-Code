# Word via COM

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
