/** Plain text for small surfaces. Preserve file-name underscores and never render HTML. */
export function plainText(text:string) {
  return text.replace(/```[^\n]*\n[\s\S]*?(?:```|$)/g,'[代码]')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g,'$1')
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm,'')
    .replace(/^\s*#{1,6}\s+/gm,'')
    .replace(/^\s*>\s?/gm,'')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g,(_,$1,$2)=>$1||$2)
    .replace(/`([^`]+)`/g,'$1')
    .replace(/^\s*\|(.+)\|\s*$/gm,(_,row)=>row.split('|').map((v:string)=>v.trim()).filter(Boolean).join('；'))
    .replace(/\s+/g,' ').trim();
}

export function taskSummary(text:string) {
  // Preview narrative only; code and delivery tables belong to the full task details.
  const prose=text.replace(/```[\s\S]*?(?:```|$)/g,'').split(/\r?\n/)
    .filter(line=>!/^\s*(?:#{1,6}\s|\||[-:]*(?:\|[- :]+)+)/.test(line)).join('\n');
  return plainText(prose);
}
