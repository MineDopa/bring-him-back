/** 正式版
 * code/bring-him-back-edit/website/main.js
 * 负责 DAY6 GitHub Pages 版本的所有交互增强：
 *  1. 3D 弹层翻书（从正文笔记本提取内容）
 *  2. 顶层场景证词手风琴（开一个收其他）
 *  3. gamebox 选项单选效果（选中高亮，同组互斥）
 *  4. bubble tooltip 的点击/触摸展开与智能定位
 */
(function () {
    'use strict';

    /* ============================================================
       工具函数
       ============================================================ */
    function $(sel, ctx) {
        return (ctx || document).querySelector(sel);
    }
    function $$(sel, ctx) {
        return Array.from((ctx || document).querySelectorAll(sel));
    }

    /* ============================================================
       1. 3D 弹层翻书
       ============================================================ */

/* ================================================================
   模块 1：DOM 助手
   ================================================================ */

const modal    = $('#bookModal');
const flipbook = modal ? $('#flipbook') : null;
const narrLayer= $('#narrationLayer');
const crewLayer= $('#crewLayer');

/* ================================================================
   模块 2：初始化（移植自 booklet 引擎，仅设 z-index / 初始可点）
   ================================================================ */
function initBook() {
    if (!flipbook) return;
    // 偶数页（正面）从外到内递减 z-index，保证翻页层次正确
    const allPages = $$('.bookpage', flipbook);
    for (let i = 0; i < allPages.length; i++) {
        if (i % 2 === 0) allPages[i].style.zIndex = String(allPages.length - i);
    }
    markClickable(0);
}
function markClickable(index) {
    if (!flipbook) return;
    $$('.bookpage', flipbook).forEach(p => p.classList.remove('clickable'));
    const p = $$('.bookpage', flipbook)[index];
    if (p) p.classList.add('clickable');
}

/* ================================================================
   模块 3：可见跨页（返回当前左右两片叶子 DOM）
   算法：右页 = 下标最小且未翻的正面；左页 = 其前一片已翻背面
   ================================================================ */
function visiblePages() {
    const kids = Array.from(flipbook.children);
    let rightIdx = -1;
    for (let i = 0; i < kids.length; i++) {
        if (kids[i].classList.contains('front') && !kids[i].classList.contains('flipped')) {
            rightIdx = i; break;
        }
    }
    if (rightIdx < 0) return [];
    const right = kids[rightIdx];
    const left = (rightIdx - 1 >= 0) ? kids[rightIdx - 1] : null;
    const out = [];
    if (left && left.classList.contains('back') && left.classList.contains('flipped')) out.push(left);
    out.push(right);
    return out;
}

/* ================================================================
   模块 4：连接器 —— 从 HTML 读取数据（不写死任何文案）
   ================================================================ */
// 读取某跨页的旁白（每片叶子内的 .page-narration）
function getNarration(pageIndices) {
    const out = [];
    pageIndices.forEach(p => {
        const leaf = $(`.bookpage[data-page="${p}"]`, flipbook);
        if (!leaf) return;
        $$('.page-narration', leaf).forEach(el => {
            const t = el.textContent.trim();
            if (t) out.push(t);
        });
    });
    return out;
}
// 读取某跨页的 crew 反应（每片叶子内的 .crew-reaction[data-who][data-color]）
function getCrew(pageIndices) {
    const out = [];
    pageIndices.forEach(p => {
        const leaf = $(`.bookpage[data-page="${p}"]`, flipbook);
        if (!leaf) return;
        $$('.crew-reaction', leaf).forEach(el => {
            out.push({
                who:   el.dataset.who || '旁白',
                color: el.dataset.color || '#888',
                text:  el.textContent.trim()
            });
        });
    });
    return out;
}

/* ================================================================
   模块 5：渲染浮层
   —— v1.7：两侧气泡（右侧 crew + 左侧旁白）出现后均 10s 自动消失
      （SuperChat 式逐条退场，不再整体定时收起）；气泡永远堆不到撑出滚动条的量
   ================================================================ */
const BUBBLE_LINGER = 10000;   // 每条气泡停留时长（毫秒）：出现后 10s 自行消失（两侧一致）
const BUBBLE_STEP   = 700;     // 每条气泡间隔
const BUBBLE_FIRST  = 500;     // 首条延迟

let appearTimers = [];         // 逐条出现的定时器
let removeTimers = [];         // 每条气泡 10s 后自动移除的定时器
function clearChat() {
    appearTimers.forEach(t => clearTimeout(t)); appearTimers = [];
    removeTimers.forEach(t => clearTimeout(t)); removeTimers = [];
    crewLayer.innerHTML = '';
    narrLayer.innerHTML = '';
}
function appendBubble(item) {
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.style.borderLeftColor = item.color;
    const name = document.createElement('span');
    name.className = 'chat-name';
    name.style.color = item.color;
    name.textContent = item.who;
    const text = document.createElement('span');
    text.className = 'chat-text';
    text.textContent = item.text;
    bubble.appendChild(name);
    bubble.appendChild(text);
    crewLayer.appendChild(bubble);
    // 这条 crew 气泡出现后 10s 自动消失
    removeTimers.push(setTimeout(() => bubble.remove(), BUBBLE_LINGER));
}
function appendNarration(text) {
    const b = document.createElement('div');
    b.className = 'narr-bubble';
    b.textContent = text;
    narrLayer.appendChild(b);
    // 这条旁白气泡出现后 10s 自动消失（与 crew 一致，不再常驻）
    removeTimers.push(setTimeout(() => b.remove(), BUBBLE_LINGER));
}
// 翻到某跨页：清空 → 渲染旁白 + 逐条流出 crew（两侧气泡出现后 10s 自行消失）
function renderSpread(pageIndices) {
    clearChat();
    if (!pageIndices || !pageIndices.length) return;
    if (!narrLayer || !crewLayer) return;
    // 旁白（合并该跨页两页，按页码升序）
    getNarration(pageIndices.slice().sort((a,b)=>a-b)).forEach(t => appendNarration(t));
    // crew（逐条从右滑入，每条出现 10s 后自动移除）
    const crew = getCrew(pageIndices);
    crew.forEach((item, i) => {
        appearTimers.push(setTimeout(() => appendBubble(item), BUBBLE_FIRST + i * BUBBLE_STEP));
    });
}

/* ================================================================
   模块 6：翻书点击（点正面往前翻 / 点背面往回翻 / 点末页合书）
   ================================================================ */
function initFlipClick() {
    if (!flipbook) return;
    markClickable(0);
    flipbook.addEventListener('click', function (e) {
        const page = e.target.closest('.bookpage');
        if (!page) { flipbook.classList.toggle('unrolled'); return; }
        e.stopPropagation();

        const pages = Array.from(flipbook.children);
        const idx = pages.indexOf(page);
        if (idx === -1) return;

        flipbook.classList.remove('unrolled');
        page.classList.remove('clickable');

        if (idx % 2 === 1) {
            // 点背面（左页）→ 往回翻
            page.classList.remove('flipped');
            pages[idx - 1].classList.remove('flipped');
            if (pages[idx + 1]) pages[idx + 1].classList.remove('clickable');
            if (idx > 1) {
                pages[idx - 1].classList.add('clickable');
                pages[idx - 2].classList.add('clickable');
            } else {
                flipbook.classList.remove('opened');
            }
            renderSpread(visiblePages().map(p => Number(p.dataset.page)));
        } else if (idx === pages.length - 1) {
            // 点末页 → 合书
            for (let i = pages.length - 1; i >= 0; i--) pages[i].classList.remove('flipped');
            flipbook.classList.remove('opened');
            markClickable(0);
            renderSpread([0]);
        } else {
            // 点正面（右页）→ 往前翻
            if (idx === 0) flipbook.classList.add('opened');
            else if (pages[idx - 1]) pages[idx - 1].classList.remove('clickable');
            page.classList.add('flipped');
            pages[idx + 1].classList.add('flipped');
            if (pages[idx + 2]) pages[idx + 2].classList.add('clickable');
            if (pages[idx + 3]) pages[idx + 3].classList.add('clickable');
            renderSpread(visiblePages().map(p => Number(p.dataset.page)));
        }
    });
}

/* ================================================================
   模块 7：打开 / 关闭
   ================================================================ */
function openModal() {
    if (!modal || !flipbook) return;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    // 重置书：合上 + 仅封面可点 + 清空浮层
    $$('.bookpage', flipbook).forEach(p => p.classList.remove('flipped', 'clickable'));
    flipbook.classList.remove('opened', 'unrolled');
    markClickable(0);
    renderSpread([0]);
}
function closeModal() {
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    clearChat();
}

/* ================================================================
   模块 8：绑定触发
   ================================================================ */
if (modal && flipbook) {
    initBook();
    initFlipClick();
}
const bookTrigger = $('#bookTrigger');
const bookClose = $('#bookClose');
if (bookTrigger) bookTrigger.addEventListener('click', openModal);
if (bookClose) bookClose.addEventListener('click', closeModal);
if (modal) {
  const backdrop = $('.book-backdrop', modal);
  if (backdrop) backdrop.addEventListener('click', closeModal);
}
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal && modal.classList.contains('is-open')) closeModal();
});

    /* ============================================================
       2. 顶层场景证词手风琴
       ============================================================ */
    function initAccordion() {
        const sceneOptions = $$('details.scene-option');
        sceneOptions.forEach(details => {
            details.addEventListener('toggle', () => {
                if (!details.open) return;
                sceneOptions.forEach(other => {
                    if (other !== details && other.open) {
                        other.open = false;
                    }
                });
            });
        });
    }

    /* ============================================================
       3. gamebox 选项单选效果
       ============================================================ */
(function() {
    // 打字机设置（可调）
    const SPEED_IN = 16;
    const SPEED_OUT = 5;

    // 每个组独立的 token 管理
    const groupTokens = new WeakMap();

    // ----- 打字机核心（与之前逻辑相同，但针对单个输出容器）-----
    function type(out, paras, my) {
        let pi = 0, ci = 0;
        let p = document.createElement('p');
        out.appendChild(p);
        (function step() {
            if (my !== groupTokens.get(out)) return;
            if (pi >= paras.length) return;
            const txt = paras[pi];
            if (ci < txt.length) {
                p.textContent += txt[ci++];
                setTimeout(step, SPEED_IN);
            } else {
                pi++; ci = 0;
                if (pi < paras.length) {
                    p = document.createElement('p');
                    out.appendChild(p);
                }
                setTimeout(step, SPEED_IN);
            }
        })();
    }

    function erase(out, my, done) {
        (function step() {
            if (my !== groupTokens.get(out)) return;
            const ps = out.querySelectorAll('p');
            if (ps.length === 0) { done(); return; }
            const last = ps[ps.length - 1];
            if (last.textContent.length > 0) {
                last.textContent = last.textContent.slice(0, -1);
                setTimeout(step, SPEED_OUT);
            } else {
                out.removeChild(last);
                setTimeout(step, SPEED_OUT);
            }
        })();
    }

    // 切换分支：从 template 读取段落文本数组
    function switchBranch(out, branch, my) {
        // 找到该输出容器所属的 group（通过父级 .choice-group）
        const group = out.closest('.choice-group');
        if (!group) return;
        // 找对应 data-branch 的 template
        const tmpl = group.querySelector(`template[data-branch="${branch}"]`);
        if (!tmpl) return;
        // 解析模板内容：取 innerHTML 按 <p> 分割，或者直接取 innerHTML 再生成 DOM
        // 推荐使用 content 克隆，然后提取所有 <p> 的文本
        const frag = tmpl.content.cloneNode(true);
        const paras = Array.from(frag.querySelectorAll('p')).map(p => p.textContent);
        if (paras.length === 0) return;

        // 开始擦除当前内容，然后打字
let myToken = groupTokens.get(out);
myToken = (myToken === undefined ? 0 : myToken) + 1;
groupTokens.set(out, myToken);
        erase(out, myToken, () => {
            if (myToken !== groupTokens.get(out)) return;
            type(out, paras, myToken);
        });
    }

    // ----- 初始化所有选项组 -----
    document.querySelectorAll('.choice-group').forEach(group => {
        // 为组内每个 radio 绑定 change 事件
        const radios = group.querySelectorAll('input[type="radio"]');
        const out = group.querySelector('.branch-output');
        if (!out) return;
        // 初始化 token
        groupTokens.set(out, 0);
        out.innerHTML = '';

        radios.forEach(radio => {
            radio.addEventListener('change', function(e) {
                if (!this.checked) return;
                const branch = this.value;  // 'a' 或 'b'
                switchBranch(out, branch);
            });
        });
    });
})();

    /* ============================================================
       4. bubble mouseover 点击/触摸展开 + 智能定位
       ============================================================ */
     document.addEventListener('mouseover', function(e) {
        const wrap = e.target.closest('.bubble-wrap');
        if (!wrap) return;

        const bubble = wrap.querySelector('.bubble');
        if (!bubble) return;

        // 获取触发器和视口数据
        const wrapRect = wrap.getBoundingClientRect();
        const vw = window.innerWidth;
        const bubbleRect = bubble.getBoundingClientRect();
        
        // 获取气泡真实宽度（因为用 opacity 隐藏，宽度依然存在）
        let bw = bubbleRect.width;
        if (bw === 0) bw = Math.min(320, vw * 0.78); // 兜底

        // 触发器中心点 X 坐标（相对于视口）
        const triggerCenterX = wrapRect.left + wrapRect.width / 2;

        // 计算理想左偏移（让气泡居中）
        let idealLeft = triggerCenterX - bw / 2;
        const margin = 10; // 安全边距
        
        // 边界限制（不让气泡跑出屏幕）
        let finalLeft = Math.max(margin, Math.min(idealLeft, vw - margin - bw));

        // 计算箭头位置（相对于气泡左边缘的百分比）
        const arrowPos = triggerCenterX - finalLeft;
        const arrowPercent = Math.min(90, Math.max(10, (arrowPos / bw) * 100));

        // 应用样式（相对于父容器 .bubble-wrap 的偏移）
        const relativeLeft = finalLeft - wrapRect.left;
        bubble.style.left = relativeLeft + 'px';
        bubble.style.transform = 'none'; // 取消居中 transform
        bubble.style.setProperty('--arrow-pos', arrowPercent + '%');
    });

    /* ============================================================
       5.密码验证
       ============================================================ */
const maskOverlay = document.getElementById("maskOverlay");
const passInput = document.getElementById("passInput");

// 页面加载时检查是否已通过验证
window.addEventListener('DOMContentLoaded', function() {
    if (!maskOverlay || !passInput) return;
    const passed = localStorage.getItem('adult_verified');
    if (passed === 'true') {
        maskOverlay.style.display = 'none';
    }
});

if (passInput) {
    passInput.addEventListener("keydown", function(e) {
        if (e.key === "Enter") {
            const inputVal = this.value.trim();
            if (inputVal === "yes,continue") {
                // 验证通过，存标记到浏览器
                localStorage.setItem('adult_verified', 'true');
                if (maskOverlay) maskOverlay.style.display = "none";
            }
        }
    });
}

    /* ============================================================
       初始化入口
       ============================================================ */
// 各模块自启动
    // 直接执行
    initAccordion();

})();
