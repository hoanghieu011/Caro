/* Đóng gói game thành một tệp HTML duy nhất, mở được trực tiếp. */
'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const template = fs.readFileSync(path.join(root, 'src', 'index.template.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'style.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'src', 'engine.js'), 'utf8');

const workerTail = `
/* -------------------------------------------------------------------
 * Giao thức Web Worker
 * ------------------------------------------------------------------- */
(function () {
  'use strict';
  self.onmessage = function (event) {
    var msg = event.data || {};
    if (msg.type !== 'move' && msg.type !== 'hint') return;
    try {
      var board = new Uint8Array(2500);
      var source = msg.board || [];
      for (var i = 0; i < 2500; i++) board[i] = source[i] || 0;
      var opts = { level: msg.level || 'super' };
      if (typeof msg.timeLimit === 'number' && msg.timeLimit > 0) opts.timeLimit = msg.timeLimit;
      var result = self.GomokuAI.chooseMove(board, msg.player === 2 ? 2 : 1, opts);
      self.postMessage({
        type: 'result',
        purpose: msg.type,
        requestId: msg.requestId,
        result: result
      });
    } catch (err) {
      self.postMessage({
        type: 'error',
        purpose: msg.type,
        requestId: msg.requestId,
        message: String(err && err.message ? err.message : err)
      });
    }
  };
})();
`;

function inject(html, token, content) {
  return html.replace(token, () => content);
}

let html = template;
html = inject(html, '<!--INLINE_CSS-->', css);
html = inject(html, '<!--INLINE_APP-->', app);
html = inject(html, '<!--INLINE_WORKER-->', engine + '\n' + workerTail);

if (html.includes('<!--INLINE_')) {
  throw new Error('Còn placeholder chưa được thay.');
}

const out = path.join(root, 'index.html');
fs.writeFileSync(out, html, 'utf8');
fs.copyFileSync(out, path.join(root, 'co-caro-50x50.html'));

console.log('Đã tạo:', out);
console.log('Kích thước:', (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1) + ' KB');
