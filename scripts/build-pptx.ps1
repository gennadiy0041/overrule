# Assembles the stage deck as a PowerPoint file from the manifest written by scripts/build-pptx.ts.
# PowerPoint itself builds the file (through COM), so the embedded film is stored exactly the way
# PowerPoint stores a video inserted by hand. Needs Windows with PowerPoint installed.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-pptx.ps1 -Manifest deck/out/pptx/manifest.json
param([Parameter(Mandatory = $true)][string]$Manifest)

$ErrorActionPreference = "Stop"
$m = Get-Content -Raw -Encoding UTF8 $Manifest | ConvertFrom-Json

# Office constants.
$msoTrue = -1
$msoFalse = 0
$ppLayoutBlank = 12
$ppSaveAsOpenXMLPresentation = 24
$msoAnimEffectMediaPlay = 83
$msoAnimateLevelNone = 0
$msoAnimTriggerAfterPrevious = 3
$ppMouseClick = 1

# Slides are 16:9 at 960 x 540 points; the manifest measures in CSS pixels of the HTML deck.
$slideWidth = 960
$slideHeight = 540
$scale = $slideWidth / $m.width

# Document properties are late-bound COM objects that PowerShell cannot index directly.
function Set-DocumentProperty($presentation, [string]$name, [string]$value) {
  $flags = [System.Reflection.BindingFlags]
  $properties = $presentation.BuiltInDocumentProperties
  $property = [System.__ComObject].InvokeMember("Item", $flags::GetProperty, $null, $properties, @($name))
  [void][System.__ComObject].InvokeMember("Value", $flags::SetProperty, $null, $property, @($value))
}

$app = New-Object -ComObject PowerPoint.Application
$pres = $app.Presentations.Add($msoFalse)
try {
  $pres.PageSetup.SlideWidth = $slideWidth
  $pres.PageSetup.SlideHeight = $slideHeight

  foreach ($s in $m.slides) {
    $slide = $pres.Slides.Add($pres.Slides.Count + 1, $ppLayoutBlank)
    $slide.FollowMasterBackground = $msoFalse
    $slide.Background.Fill.Solid()
    $slide.Background.Fill.ForeColor.RGB = 0

    if ($s.film) {
      # The film fills the slide and starts by itself when the slide opens; a click on it pauses or resumes.
      $film = $slide.Shapes.AddMediaObject2($m.film, $msoFalse, $msoTrue, 0, 0, $slideWidth, $slideHeight)
      $film.Name = "Film"
      $film.AlternativeText = $s.alt
      $film.MediaFormat.SetDisplayPictureFromFile($m.poster)
      $film.MediaFormat.Volume = 1
      $film.MediaFormat.Muted = $msoFalse
      [void]$slide.TimeLine.MainSequence.AddEffect($film, $msoAnimEffectMediaPlay, $msoAnimateLevelNone, $msoAnimTriggerAfterPrevious)
    }
    else {
      $picture = $slide.Shapes.AddPicture($s.image, $msoFalse, $msoTrue, 0, 0, $slideWidth, $slideHeight)
      $picture.Name = "Slide $($s.number)"
      $picture.AlternativeText = $s.alt
    }

    # Links of the HTML deck become invisible, clickable areas in the same places.
    $n = 0
    foreach ($link in $s.links) {
      $n++
      $area = $slide.Shapes.AddShape(1, $link.x * $scale, $link.y * $scale, $link.w * $scale, $link.h * $scale)
      $area.Name = "Link $n"
      $area.AlternativeText = $link.href
      $area.Line.Visible = $msoFalse
      $area.Fill.Solid()
      $area.Fill.ForeColor.RGB = 16777215
      $area.Fill.Transparency = 1
      $area.ActionSettings.Item($ppMouseClick).Hyperlink.Address = $link.href
    }

    if ($s.notes) {
      $slide.NotesPage.Shapes.Placeholders.Item(2).TextFrame.TextRange.Text = $s.notes
    }
  }

  Set-DocumentProperty $pres "Title" $m.title
  Set-DocumentProperty $pres "Author" $m.author
  if (Test-Path $m.output) { Remove-Item $m.output -Force }
  $pres.SaveAs($m.output, $ppSaveAsOpenXMLPresentation)
  Write-Output "saved: $($m.output) ($($pres.Slides.Count) slides)"
}
catch {
  # Say where it failed: a COM error carries no line number of its own.
  Write-Output "FAILED: $($_.Exception.Message)"
  Write-Output $_.ScriptStackTrace
  throw
}
finally {
  $pres.Close()
  # Leave PowerPoint running if the user has other presentations open in it.
  if ($app.Presentations.Count -eq 0) { $app.Quit() }
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($pres)
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
