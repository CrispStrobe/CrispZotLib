find . \
  -type f \
  ! -path './.git/*' \
  ! -path './.github/*' \
  ! -path './.scaffold/*' \
  ! -path './.vscode/*' \
  ! -path './doc/*' \
  ! -path './node_modules/*' \
  ! -name 'package-lock.json' \
  ! -name 'LICENSE' \
  ! -name '*.xpi' \
  \( -name '*.ts' -o -name '*.js' -o -name '*.ftl' -o -name '*.mjs' -o -name '*.json' -o -name '*.md' -o -name '*.html' -o -name '*.xhtml' -o -name '*.css' \) \
  -exec sh -c 'for f; do echo "$f:"; head -n 100 "$f"; echo; done' sh {} +

