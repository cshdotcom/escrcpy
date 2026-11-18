<template>
  <div class="markdown-view" v-html="rendered"></div>
</template>

<script setup>
const props = defineProps({
  content: {
    type: String,
    default: '',
  },
})

const rendered = computed(() => renderMarkdown(props.content))

function escapeHTML(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderInline(text) {
  let value = escapeHTML(text)

  // inline code
  value = value.replace(/`([^`\n]+)`/g, (_, code) => `<code class="md-code">${code}</code>`)

  // images: ![alt](url) — only data urls (screenshots) and http(s)
  value = value.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, alt, url) => {
    if (!/^(https?:|data:image\/)/i.test(url))
      return alt || match
    return `<img class="md-img" src="${url}" alt="${alt}" loading="lazy" />`
  })

  // links: [text](url)
  value = value.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a class="md-link" href="$2" target="_blank" rel="noopener noreferrer">$1</a>')

  // bold / italic
  value = value.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  value = value.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')

  // strikethrough
  value = value.replace(/~~([^~]+)~~/g, '<del>$1</del>')

  return value
}

function renderMarkdown(source) {
  const text = String(source || '')
  if (!text.trim())
    return ''

  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const html = []
  let index = 0

  const flushParagraph = buffer => (buffer.length ? `<p>${buffer.map(renderInline).join('<br />')}</p>` : '')

  while (index < lines.length) {
    const line = lines[index]

    // fenced code block
    if (/^\s*```/.test(line)) {
      const lang = line.replace(/^\s*```/, '').trim()
      const buffer = []
      index++
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        buffer.push(lines[index])
        index++
      }
      index++ // skip closing fence
      const langAttr = lang ? ` data-lang="${escapeHTML(lang)}"` : ''
      html.push(`<pre class="md-pre"${langAttr}><code>${escapeHTML(buffer.join('\n'))}</code></pre>`)
      continue
    }

    // heading
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      const level = Math.min(heading[1].length + 1, 6)
      html.push(`<h${level} class="md-h${level}">${renderInline(heading[2])}</h${level}>`)
      index++
      continue
    }

    // horizontal rule
    if (/^\s*(\*\s*){3,}$|^\s*(-\s*){3,}$/.test(line)) {
      html.push('<hr class="md-hr" />')
      index++
      continue
    }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      const buffer = []
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        buffer.push(lines[index].replace(/^\s*>\s?/, ''))
        index++
      }
      html.push(`<blockquote class="md-quote">${buffer.map(renderInline).join('<br />')}</blockquote>`)
      continue
    }

    // table
    if (/\|/.test(line) && index + 1 < lines.length && /^[\s:|-]+\|[\s:|-]*$/.test(lines[index + 1])) {
      const parseRow = (row) => {
        return row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(cell => cell.trim())
      }
      const headers = parseRow(line)
      index += 2
      const rows = []
      while (index < lines.length && /\|/.test(lines[index]) && lines[index].trim()) {
        rows.push(parseRow(lines[index]))
        index++
      }
      const thead = `<tr>${headers.map(cell => `<th>${renderInline(cell)}</th>`).join('')}</tr>`
      const tbody = rows.map(row => `<tr>${row.map(cell => `<td>${renderInline(cell)}</td>`).join('')}</tr>`).join('')
      html.push(`<div class="md-table-wrap"><table class="md-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`)
      continue
    }

    // unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = []
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*+]\s+/, ''))
        index++
      }
      html.push(`<ul class="md-ul">${items.map(item => `<li>${renderInline(item)}</li>`).join('')}</ul>`)
      continue
    }

    // ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = []
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+[.)]\s+/, ''))
        index++
      }
      html.push(`<ol class="md-ol">${items.map(item => `<li>${renderInline(item)}</li>`).join('')}</ol>`)
      continue
    }

    // paragraph
    const buffer = []
    while (
      index < lines.length
      && lines[index].trim()
      && !/^\s*(```|#{1,6}\s|>|[-*+]\s|\d+[.)]\s)/.test(lines[index])
    ) {
      buffer.push(lines[index])
      index++
    }
    if (buffer.length) {
      html.push(flushParagraph(buffer))
    }
    else {
      index++
    }
  }

  return html.join('\n')
}
</script>

<style lang="postcss" scoped>
.markdown-view {
  @apply text-sm leading-relaxed break-words;

  :deep() {
    p {
      @apply my-1.5;
    }

    .md-h2,
    .md-h3,
    .md-h4,
    .md-h5,
    .md-h6 {
      @apply mt-3 mb-1.5 font-semibold;
    }

    .md-h2 {
      @apply text-base;
    }

    .md-h3 {
      @apply text-[0.95rem];
    }

    .md-h4,
    .md-h5,
    .md-h6 {
      @apply text-sm;
    }

    .md-code {
      @apply px-1.5 py-0.5 rounded text-[0.85em] bg-gray-200/80 dark:bg-gray-700 text-rose-600 dark:text-rose-300;
    }

    .md-pre {
      @apply my-2 p-3 rounded-md overflow-auto text-xs leading-normal
        bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700;

      code {
        @apply bg-transparent p-0 text-gray-800 dark:text-gray-200;
        font-family: 'JetBrains Mono', Consolas, Monaco, 'Courier New', monospace;
      }
    }

    .md-link {
      @apply text-blue-600 dark:text-blue-400 underline break-all;
    }

    .md-img {
      @apply max-w-full max-h-90 rounded-md my-1 border border-gray-200 dark:border-gray-700;
    }

    .md-hr {
      @apply my-3 border-t border-gray-200 dark:border-gray-700;
    }

    .md-quote {
      @apply my-2 pl-3 py-1 border-l-3 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400;
    }

    .md-ul {
      @apply my-1.5 pl-5 list-disc space-y-0.5;
    }

    .md-ol {
      @apply my-1.5 pl-5 list-decimal space-y-0.5;
    }

    .md-table-wrap {
      @apply my-2 overflow-x-auto;
    }

    .md-table {
      @apply w-full max-w-full text-xs border-collapse;

      th,
      td {
        @apply px-2 py-1 border border-gray-200 dark:border-gray-700 text-left;
      }

      th {
        @apply bg-gray-100 dark:bg-gray-800 font-semibold;
      }
    }
  }
}
</style>
