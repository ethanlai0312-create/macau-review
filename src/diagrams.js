export function diagram(id,T) {
  if(id==='water') return `<figure><svg viewBox="0 0 540 235" role="img" aria-label="${T('用水练习图：洗手20升，清洁50升，浇灌30升。')}">
    <g fill="currentColor" font-size="16"><text x="20" y="25">${T('用水量（升）· 练习设定数据')}</text>
    <text x="20" y="82">${T('洗手')}</text><text x="20" y="137">${T('清洁')}</text><text x="20" y="192">${T('浇灌')}</text></g>
    <g fill="#3a6660"><rect x="90" y="54" width="140" height="38" rx="6"/><rect x="90" y="109" width="350" height="38" rx="6"/><rect x="90" y="164" width="210" height="38" rx="6"/></g>
    <g fill="currentColor" font-size="18"><text x="240" y="80">20</text><text x="450" y="135">50</text><text x="310" y="190">30</text></g></svg>
    <figcaption>${T('数据仅用于计算练习，不代表澳门实际统计。')}</figcaption></figure>`;
  return `<figure><svg viewBox="0 0 540 380" role="img" aria-label="${T('新城填海区方位示意：A区在澳门半岛东侧，B区在半岛南侧，氹仔北侧由西向东为C、D、E1、E2区。')}">
    <rect width="540" height="380" rx="14" fill="#edf3f4"/>
    <path d="M65 15H246L260 85 237 137 248 190 204 225 100 202 78 140Z" fill="#dce2d7" stroke="#a1afa2"/>
    <path d="M92 320Q280 270 506 330L530 380H60Z" fill="#dce2d7" stroke="#a1afa2"/>
    <g fill="#d4e6e0" stroke="#3a6660" stroke-width="2"><path d="M290 65L327 82 340 224 305 216Z"/><path d="M100 220L204 240 252 220 247 246 199 260 100 242Z"/>
    <rect x="130" y="284" width="54" height="30" rx="6"/><rect x="215" y="272" width="70" height="30" rx="6"/><rect x="315" y="278" width="64" height="30" rx="6"/><rect x="410" y="291" width="62" height="30" rx="6"/></g>
    <g font-size="18" fill="#243f3a" text-anchor="middle"><text x="170" y="118">${T('澳门半岛')}</text><text x="315" y="155">A</text><text x="185" y="245">B</text><text x="157" y="306">C</text><text x="250" y="294">D</text><text x="347" y="300">E1</text><text x="441" y="313">E2</text><text x="285" y="354">${T('氹仔')}</text></g>
    <path d="M475 80V35M465 47L475 35 485 47" fill="none" stroke="#243f3a" stroke-width="2"/><text x="468" y="25" font-size="17">${T('北')}</text>
    </svg><figcaption>${T('依据教材重绘的相对方位示意图，不按比例绘制；不表示现时工程边界。')}</figcaption></figure>`;
}
