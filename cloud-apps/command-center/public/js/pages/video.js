import { pg, pill, btn, head } from '../ui.js';

export function render(d) {
  const edit = d.editing.rows.map((r) => `<div class="r"><div><strong>${r.title}</strong><small>${r.sub}</small>${pg(r.pct)}</div><div class="right">${pill(r.pill, r.pillCls || '')}${r.btn ? btn(r.btn, { msg: r.msg, cls: 'line', sm: true }) : ''}</div></div>`).join('');
  const ready = d.ready.rows.map((r) => `<div class="r"><div><strong>${r.title}</strong><small>${r.sub}</small></div><div class="right">${btn('Send notes', { msg: 'Notes box opened', cls: 'line' })}${btn('Watch', { msg: 'Opened the cut for review' })}</div></div>`).join('');
  const fin = d.finished.rows.map((r) => `<tr><td>${r.video}</td><td>${r.finished}</td><td class="num">${r.time}</td><td>${pill(r.where, 'ok')}</td></tr>`).join('');
  return `<div class="wrap">
  ${head(d.title, d.sub)}
  <div class="split">
    <div class="stackcol">
      <div class="card pad">
        <div class="cardhead"><h2>${d.editing.title}</h2><span class="meta">${d.editing.meta}</span></div>
        <div class="rows">${edit}</div>
      </div>
      <div class="card pad">
        <div class="cardhead"><h2>${d.ready.title}</h2></div>
        <div class="rows">${ready}</div>
      </div>
      <div class="card pad">
        <div class="cardhead"><h2>${d.finished.title}</h2></div>
        <div class="tblwrap"><table><thead><tr><th>Video</th><th>Finished</th><th class="num">Edit time</th><th>Where it went</th></tr></thead><tbody>${fin}</tbody></table></div>
      </div>
    </div>
    <div class="stackcol">
      <div class="card pad">
        <div class="cardhead"><h2>${d.upload.title}</h2></div>
        <div class="drop"><svg class="ic" style="width:1.8rem;height:1.8rem;color:var(--accent)"><use href="#i-up"/></svg><strong>${d.upload.drop}</strong><span>${d.upload.sub}</span>${btn(d.upload.btn, { msg: d.upload.msg })}</div>
      </div>
      <div class="card pad">
        <div class="cardhead"><h2>${d.target.title}</h2></div>
        <div class="pgs">${d.target.rows.map((r) => `<div class="pgrow"><div class="lab"><span>${r.label}</span><span>${r.value}</span></div>${pg(r.pct, (r.pg || '') + ' tall')}</div>`).join('')}</div>
      </div>
    </div>
  </div>
</div>`;
}
