# Excel via COM

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
