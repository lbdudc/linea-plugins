<script setup>
import { computed } from 'vue';
import DOMPurify from 'dompurify';

const props = defineProps({
  text: { type: String, default: '' },
});

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const URL_RE = /((?:https?:\/\/)[^\s<>"')\]]+)/g;

const linkify = (escaped) =>
  escaped
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(URL_RE, (m, url, offset, str) => {
      const before = str.slice(0, offset);
      const openA = before.lastIndexOf('<a ');
      const closeA = before.lastIndexOf('</a>');
      if (openA > closeA) return m;
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    });

const inline = (escaped) => {
  let out = linkify(escaped);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  return out;
};

const renderedHtml = computed(() => {
  const raw = props.text ?? '';
  if (!raw) return '';

  const lines = raw.split('\n');
  const out = [];
  let i = 0;
  let listBuffer = null;

  const flushList = () => {
    if (!listBuffer) return;
    out.push(`<${listBuffer.tag}>${listBuffer.items.map((it) => `<li>${inline(it)}</li>`).join('')}</${listBuffer.tag}>`);
    listBuffer = null;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      const fenceLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        fenceLines.push(lines[i]);
        i++;
      }
      i++;
      flushList();
      out.push(`<pre><code>${escapeHtml(fenceLines.join('\n'))}</code></pre>`);
      continue;
    }

    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flushList();
      const level = h[1].length;
      out.push(`<h${level}>${inline(escapeHtml(h[2]))}</h${level}>`);
      i++;
      continue;
    }

    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      const tag = ol ? 'ol' : 'ul';
      const content = escapeHtml((ul ?? ol)[1]);
      if (listBuffer && listBuffer.tag !== tag) flushList();
      if (!listBuffer) listBuffer = { tag, items: [] };
      listBuffer.items.push(content);
      i++;
      continue;
    }

    const bq = /^\s*>\s?(.*)$/.exec(line);
    if (bq) {
      flushList();
      out.push(`<blockquote>${inline(escapeHtml(bq[1]))}</blockquote>`);
      i++;
      continue;
    }

    if (line.trim() === '') {
      flushList();
      i++;
      continue;
    }

    flushList();
    out.push(`<p>${inline(escapeHtml(line))}</p>`);
    i++;
  }
  flushList();
  return DOMPurify.sanitize(out.join('\n'), { ADD_ATTR: ['target', 'rel'] });
});
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- renderedHtml pasa por DOMPurify.sanitize() arriba, no es HTML crudo -->
  <div class="markdown-view" v-html="renderedHtml" />
</template>

<style scoped>
.markdown-view { min-width: 0; overflow-wrap: break-word; font-size: 13px; color: var(--p-text-secondary-color); }
.markdown-view :deep(h1) { font-size: 1.2rem; font-weight: 700; margin: 1rem 0 0.5rem; color: var(--p-text-color); }
.markdown-view :deep(h2) { font-size: 1.1rem; font-weight: 600; margin: 1rem 0 0.4rem; color: var(--p-text-color); }
.markdown-view :deep(h3) { font-size: 1rem; font-weight: 600; margin: 0.8rem 0 0.3rem; color: var(--p-text-color); }
.markdown-view :deep(p)  { margin: 0.3rem 0; }
.markdown-view :deep(ul) { padding-left: 1.2rem; margin: 0.3rem 0; }
.markdown-view :deep(ol) { padding-left: 1.3rem; margin: 0.3rem 0; }
.markdown-view :deep(li) { margin: 0.15rem 0; }
.markdown-view :deep(code) { background: var(--p-content-hover-background); padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.88em; overflow-wrap: break-word; word-break: break-word; }
.markdown-view :deep(pre) { background: var(--p-content-hover-background); padding: 0.6rem 0.8rem; border-radius: 4px; overflow-x: auto; }
.markdown-view :deep(pre code) { background: none; padding: 0; }
.markdown-view :deep(a) { color: var(--p-agent-color); text-decoration: underline; cursor: pointer; }
.markdown-view :deep(a:hover) { color: var(--p-agent-hover-color); }
.markdown-view :deep(strong) { font-weight: 600; color: var(--p-text-color); }
.markdown-view :deep(blockquote) { margin: 0.4rem 0; padding: 0.2rem 0.8rem; border-left: 3px solid var(--p-content-border-color); color: var(--p-text-muted-color); }
</style>
