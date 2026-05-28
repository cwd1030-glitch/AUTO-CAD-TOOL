# STL 샘플 파일 생성 스크립트
# 박스 + 보스(Boss) 형태의 사출품 모델

$outputPath = "c:\Users\mecha\PROJECT\AUTO_CAD_TOOL\samples\sample_part.stl"

# ASCII STL 생성 (간단한 상자 + 보스 형태)
$stlContent = @"
solid sample_injection_part
  facet normal 0 0 -1
    outer loop
      vertex 0 0 0
      vertex 40 0 0
      vertex 40 30 0
    endloop
  endfacet
  facet normal 0 0 -1
    outer loop
      vertex 0 0 0
      vertex 40 30 0
      vertex 0 30 0
    endloop
  endfacet
  facet normal 0 0 1
    outer loop
      vertex 0 0 10
      vertex 40 30 10
      vertex 40 0 10
    endloop
  endfacet
  facet normal 0 0 1
    outer loop
      vertex 0 0 10
      vertex 0 30 10
      vertex 40 30 10
    endloop
  endfacet
  facet normal 0 -1 0
    outer loop
      vertex 0 0 0
      vertex 40 0 10
      vertex 40 0 0
    endloop
  endfacet
  facet normal 0 -1 0
    outer loop
      vertex 0 0 0
      vertex 0 0 10
      vertex 40 0 10
    endloop
  endfacet
  facet normal 0 1 0
    outer loop
      vertex 0 30 0
      vertex 40 30 0
      vertex 40 30 10
    endloop
  endfacet
  facet normal 0 1 0
    outer loop
      vertex 0 30 0
      vertex 40 30 10
      vertex 0 30 10
    endloop
  endfacet
  facet normal -1 0 0
    outer loop
      vertex 0 0 0
      vertex 0 30 0
      vertex 0 30 10
    endloop
  endfacet
  facet normal -1 0 0
    outer loop
      vertex 0 0 0
      vertex 0 30 10
      vertex 0 0 10
    endloop
  endfacet
  facet normal 1 0 0
    outer loop
      vertex 40 0 0
      vertex 40 30 10
      vertex 40 30 0
    endloop
  endfacet
  facet normal 1 0 0
    outer loop
      vertex 40 0 0
      vertex 40 0 10
      vertex 40 30 10
    endloop
  endfacet
  facet normal 0 0 1
    outer loop
      vertex 15 10 10
      vertex 25 10 10
      vertex 25 20 10
    endloop
  endfacet
  facet normal 0 0 1
    outer loop
      vertex 15 10 10
      vertex 25 20 10
      vertex 15 20 10
    endloop
  endfacet
  facet normal 0 0 -1
    outer loop
      vertex 15 10 18
      vertex 25 20 18
      vertex 25 10 18
    endloop
  endfacet
  facet normal 0 0 -1
    outer loop
      vertex 15 10 18
      vertex 15 20 18
      vertex 25 20 18
    endloop
  endfacet
  facet normal 0 -1 0
    outer loop
      vertex 15 10 10
      vertex 25 10 10
      vertex 25 10 18
    endloop
  endfacet
  facet normal 0 -1 0
    outer loop
      vertex 15 10 10
      vertex 25 10 18
      vertex 15 10 18
    endloop
  endfacet
  facet normal 0 1 0
    outer loop
      vertex 15 20 10
      vertex 25 20 18
      vertex 25 20 10
    endloop
  endfacet
  facet normal 0 1 0
    outer loop
      vertex 15 20 10
      vertex 15 20 18
      vertex 25 20 18
    endloop
  endfacet
  facet normal -1 0 0
    outer loop
      vertex 15 10 10
      vertex 15 20 10
      vertex 15 20 18
    endloop
  endfacet
  facet normal -1 0 0
    outer loop
      vertex 15 10 10
      vertex 15 20 18
      vertex 15 10 18
    endloop
  endfacet
  facet normal 1 0 0
    outer loop
      vertex 25 10 10
      vertex 25 20 18
      vertex 25 20 10
    endloop
  endfacet
  facet normal 1 0 0
    outer loop
      vertex 25 10 10
      vertex 25 10 18
      vertex 25 20 18
    endloop
  endfacet
  facet normal 0 -0.1 0.995
    outer loop
      vertex 0 0 0
      vertex 40 0 0
      vertex 38 2 10
    endloop
  endfacet
  facet normal 0.1 0 0.995
    outer loop
      vertex 40 0 0
      vertex 40 30 0
      vertex 38 28 10
    endloop
  endfacet
  facet normal 0 0.05 0.999
    outer loop
      vertex 0 5 0
      vertex 40 5 0
      vertex 40 5 10
    endloop
  endfacet
  facet normal 0 0.05 0.999
    outer loop
      vertex 0 5 0
      vertex 40 5 10
      vertex 0 5 10
    endloop
  endfacet
endsolid sample_injection_part
"@

$stlContent | Out-File -FilePath $outputPath -Encoding UTF8
Write-Host "STL 파일 생성 완료: $outputPath" -ForegroundColor Green
Write-Host "파일 크기: $((Get-Item $outputPath).Length) bytes" -ForegroundColor Cyan
