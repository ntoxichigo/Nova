function looksLikeHtmlDocument(content: string): boolean {
  return /<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]/i.test(content);
}

function injectBeforeClosingTag(source: string, tagName: string, injection: string): string {
  const closingTag = new RegExp(`</${tagName}>`, 'i');
  if (closingTag.test(source)) {
    return source.replace(closingTag, `${injection}\n</${tagName}>`);
  }
  return `${source}\n${injection}`;
}

function ensureHtmlDocument(source: string, title: string): string {
  if (looksLikeHtmlDocument(source)) {
    return source;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body>
${source}
</body>
</html>`;
}

function ensureViewportMeta(source: string): string {
  if (/<meta[^>]+name=["']viewport["']/i.test(source)) {
    return source;
  }

  if (/<head[^>]*>/i.test(source)) {
    return source.replace(
      /<head[^>]*>/i,
      (match) => `${match}\n<meta name="viewport" content="width=device-width, initial-scale=1.0">`,
    );
  }

  if (/<body[^>]*>/i.test(source)) {
    return source.replace(
      /<body[^>]*>/i,
      `<head>\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n</head>\n$&`,
    );
  }

  return `<meta name="viewport" content="width=device-width, initial-scale=1.0">\n${source}`;
}

const PREVIEW_GUARD_STYLE = `<style id="nova-preview-guard">html,body{margin:0;max-width:100%;overflow-x:hidden!important;}body{min-height:100vh;overscroll-behavior:none;}*,*::before,*::after{box-sizing:border-box;min-width:0;}img,video,svg,canvas,iframe{display:block;max-width:100%!important;}canvas{width:100%!important;height:auto!important;}table{display:block;max-width:100%;overflow-x:auto;}pre,code{white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;}body>*{max-width:100%;}body [style*="100vw"],body [style*="width: 100vw"]{max-width:100%!important;}</style>`;

const PREVIEW_GUARD_SCRIPT = `<script id="nova-preview-guard-script">(()=>{const sync=()=>{document.documentElement.style.overflowX='hidden';if(document.body){document.body.style.overflowX='hidden';}document.querySelectorAll('canvas').forEach((canvas)=>{canvas.style.maxWidth='100%';canvas.style.width='100%';canvas.style.height='auto';const parent=canvas.parentElement;if(!parent)return;const width=Math.floor(parent.getBoundingClientRect().width);if(width>0&&canvas.width>width*1.25){const ratio=canvas.height&&canvas.width?canvas.height/canvas.width:0;canvas.style.width='100%';if(ratio>0){canvas.style.height=\`\${Math.round(width*ratio)}px\`;}}});};window.addEventListener('resize',sync,{passive:true});window.addEventListener('orientationchange',sync,{passive:true});window.addEventListener('load',sync,{once:true});setTimeout(sync,0);setTimeout(sync,250);})();</script>`;

export function applyResponsiveHtmlGuard(content: string, title = 'Preview'): string {
  let out = ensureHtmlDocument(content, title);
  out = ensureViewportMeta(out);

  if (!/id=["']nova-preview-guard["']/i.test(out)) {
    out = injectBeforeClosingTag(out, 'head', PREVIEW_GUARD_STYLE);
  }

  if (!/id=["']nova-preview-guard-script["']/i.test(out)) {
    out = injectBeforeClosingTag(out, 'body', PREVIEW_GUARD_SCRIPT);
  }

  return out;
}
