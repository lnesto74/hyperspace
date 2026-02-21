#!/bin/bash
# IndexNow Bulk URL Submission for hyspace.app

curl -X POST "https://api.indexnow.org/IndexNow" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{
    "host": "www.hyspace.app",
    "key": "a47188cb1c314e64aa797080b7c5782d",
    "keyLocation": "https://www.hyspace.app/a47188cb1c314e64aa797080b7c5782d.txt",
    "urlList": [
      "https://www.hyspace.app/",
      "https://www.hyspace.app/physical-ai.html",
      "https://www.hyspace.app/spatial-intelligence.html",
      "https://www.hyspace.app/lidar-analytics.html",
      "https://www.hyspace.app/lidar-as-a-service.html",
      "https://www.hyspace.app/hardware-agnostic-lidar.html",
      "https://www.hyspace.app/privacy-first-analytics.html",
      "https://www.hyspace.app/solutions/retail-analytics.html",
      "https://www.hyspace.app/solutions/grocery-analytics.html",
      "https://www.hyspace.app/solutions/airports.html",
      "https://www.hyspace.app/solutions/smart-buildings.html",
      "https://www.hyspace.app/locations/europe.html",
      "https://www.hyspace.app/locations/italy.html",
      "https://www.hyspace.app/locations/singapore.html",
      "https://www.hyspace.app/locations/uk.html",
      "https://www.hyspace.app/locations/usa.html"
    ]
  }' -v
