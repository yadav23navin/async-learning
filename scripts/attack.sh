#!/bin/bash

URL="http://localhost:3000/validation"

echo "1. Extra key"
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d '{"name":"Navin","role":"admin"}'

echo "2. Wrong type"
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d '{"name":123}'

echo "3. Script tag"
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d '{"name":"<script>alert(1)</script>"}'

echo "4. 10MB body"
python3 -c 'import json; print(json.dumps({"name":"A"*10000000}))' |
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "$URL" \
  -H "Content-Type: application/json" \
  --data-binary @-

echo "5. Negative limit"
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d '{"name":"Navin","limit":-10}'

echo "6. Missing body"
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "$URL"

echo "7. SQL-like filter"
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d '{"name":"Navin","filter":"status='\''open'\'' OR 1=1"}'

echo "8. Null byte"
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d '{"name":"Navin\u0000Test"}'

echo "9. Control character"
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d '{"name":"Navin\u0007Test"}'

echo "10. Duplicate key"
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d '{"name":"Navin","name":"Admin"}'