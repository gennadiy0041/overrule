# Checks the PowerPoint deck with PowerPoint itself, without showing anything on screen:
# what is on each slide, whether the film is stored inside the file and set to start by itself,
# a picture of every slide, and (with -Video) a recording of the whole slide show, which proves
# that PowerPoint can actually play the embedded film with its sound.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-pptx.ps1 -Deck deck/Overrule_BusinessCup2.pptx -OutDir deck/out/pptx-check -Video
param(
  [Parameter(Mandatory = $true)][string]$Deck,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [switch]$Video
)

$ErrorActionPreference = "Stop"
$msoTrue = -1
$msoFalse = 0
$msoMedia = 16
$ppMediaTaskStatusDone = 3
$ppMediaTaskStatusFailed = 4

New-Item -ItemType Directory -Force $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
# Work on a copy: the deck itself is never opened, locked or changed by the check.
$copy = Join-Path $OutDir "deck-under-check.pptx"
Copy-Item -LiteralPath (Resolve-Path -LiteralPath $Deck).Path -Destination $copy -Force

$app = New-Object -ComObject PowerPoint.Application
$pres = $app.Presentations.Open($copy, $msoFalse, $msoFalse, $msoFalse)
try {
  Write-Output "slides: $($pres.Slides.Count) | slide size: $($pres.PageSetup.SlideWidth) x $($pres.PageSetup.SlideHeight) pt"
  foreach ($slide in $pres.Slides) {
    $pictures = 0; $links = @(); $media = @()
    foreach ($shape in $slide.Shapes) {
      if ($shape.Type -eq $msoMedia) {
        $f = $shape.MediaFormat
        $media += "film: $([math]::Round($f.Length / 1000, 1)) s, embedded=$($f.IsEmbedded -eq $msoTrue), linked=$($f.IsLinked -eq $msoTrue), muted=$($f.Muted -eq $msoTrue), volume=$([math]::Round($f.Volume, 2)), at ($([math]::Round($shape.Left)),$([math]::Round($shape.Top))) $([math]::Round($shape.Width)) x $([math]::Round($shape.Height))"
      }
      elseif ($shape.Type -eq 13) { $pictures++ }
      else {
        $address = $shape.ActionSettings.Item(1).Hyperlink.Address
        if ($address) { $links += $address }
      }
    }
    $effects = @()
    foreach ($effect in $slide.TimeLine.MainSequence) {
      $effects += "effect $($effect.EffectType) on '$($effect.Shape.Name)' trigger $($effect.Timing.TriggerType) delay $($effect.Timing.TriggerDelayTime)"
    }
    $notes = $slide.NotesPage.Shapes.Placeholders.Item(2).TextFrame.TextRange.Text
    $line = "slide $($slide.SlideIndex): pictures=$pictures, links=$($links.Count), notes=$($notes.Length) chars"
    if ($media.Count) { $line += " | " + ($media -join "; ") }
    if ($effects.Count) { $line += " | " + ($effects -join "; ") }
    Write-Output $line
    foreach ($address in $links) { Write-Output "    link: $address" }
    $slide.Export((Join-Path $OutDir ("slide-{0:d2}.png" -f $slide.SlideIndex)), "PNG", 1920, 1080)
  }

  if ($Video) {
    # Two seconds a slide; the film slide lasts as long as the film, because it starts by itself.
    $show = Join-Path $OutDir "show.mp4"
    if (Test-Path $show) { Remove-Item $show -Force }
    $pres.CreateVideo($show, $msoFalse, 2, 720, 30, 85)
    $waited = 0
    while ($pres.CreateVideoStatus -ne $ppMediaTaskStatusDone -and $pres.CreateVideoStatus -ne $ppMediaTaskStatusFailed -and $waited -lt 600) {
      Start-Sleep -Seconds 2
      $waited += 2
    }
    Write-Output "slide show recording: status $($pres.CreateVideoStatus) after $waited s -> $show"
  }
}
finally {
  $pres.Saved = $msoTrue
  $pres.Close()
  if ($app.Presentations.Count -eq 0) { $app.Quit() }
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($pres)
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
