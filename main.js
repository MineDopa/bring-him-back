/**
 * main.js
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

  const modal = $('#bookModal');
  const flipbook = $('#flipbook');
  const narrLayer = $('#narrationLayer');
  const crewLayer = $('#crewLayer');

  /* ================================================================
   模块 2：初始化（双页 booklet 引擎）
   —— HTML 叶子顺序：back(idx偶) + front(idx奇) 交替
      第一对 = child1(back,p1)+child2(front,p2)，第二对 = child3+p4 …
   —— z-index：外对（pairIdx 小）= 高，覆盖内对
   —— 当前对显示由 showPair() 控制（opacity 切换 + back 加 flipped）
   ================================================================ */
  function initBook() {
    const allPages = $$('.bookpage', flipbook);
    const pairs = Math.ceil(allPages.length / 2);
    for (let i = 0; i < allPages.length; i++) {
      const pairIdx = Math.floor(i / 2);
      allPages[i].style.zIndex = String((pairs - pairIdx) * 2);
    }
  }
  function markClickable(index) {
    $$('.bookpage', flipbook).forEach((p) => p.classList.remove('clickable'));
    const p = $$('.bookpage', flipbook)[index];
    if (p) p.classList.add('clickable');
  }

  /* ================================================================
   模块 2.5：showPair — 切换当前显示的对
   —— pairIdx 0=第一对(child1+child2), 1=第二对(child3+child4) …
   —— 显示：back add flipped(rotateY(0) 左可见) + front 默认(rotateY(0) 右可见) + opacity:1
   —— 隐藏：opacity:0 + pointerEvents:none + 移除 flipped
   ================================================================ */
  function showPair(pairIdx) {
    const pages = $$('.bookpage', flipbook);
    pages.forEach((p, i) => {
      const pIdx = Math.floor(i / 2);
      const isBack = i % 2 === 0;
      if (pIdx === pairIdx) {
        p.style.opacity = '1';
        p.style.pointerEvents = '';
        if (isBack) p.classList.add('flipped');
        else p.classList.remove('flipped');
      } else {
        p.style.opacity = '0';
        p.style.pointerEvents = 'none';
        p.classList.remove('flipped');
      }
    });
  }

  /* ================================================================
   模块 3：可见跨页（返回当前左右两片叶子 DOM）
   算法：右页 = 下标最小且未翻的正面；左页 = 其前一片已翻背面
   ================================================================ */
  function visiblePages() {
    const kids = Array.from(flipbook.children);
    let rightIdx = -1;
    for (let i = 0; i < kids.length; i++) {
      if (
        kids[i].classList.contains('front') &&
        !kids[i].classList.contains('flipped')
      ) {
        rightIdx = i;
        break;
      }
    }
    if (rightIdx < 0) return [];
    const right = kids[rightIdx];
    const left = rightIdx - 1 >= 0 ? kids[rightIdx - 1] : null;
    const out = [];
    if (
      left &&
      left.classList.contains('back') &&
      left.classList.contains('flipped')
    )
      out.push(left);
    out.push(right);
    return out;
  }

  /* ================================================================
   模块 4：连接器 —— 从 HTML 读取数据（不写死任何文案）
   ================================================================ */
  // 读取某跨页的旁白（每片叶子内的 .page-narration）
  function getNarration(pageIndices) {
    const out = [];
    pageIndices.forEach((p) => {
      const leaf = $(`.bookpage[data-page="${p}"]`, flipbook);
      if (!leaf) return;
      $$('.page-narration', leaf).forEach((el) => {
        const t = el.textContent.trim();
        if (t) out.push(t);
      });
    });
    return out;
  }
  // 读取某跨页的 crew 反应（每片叶子内的 .crew-reaction[data-who][data-color]）
  function getCrew(pageIndices) {
    const out = [];
    pageIndices.forEach((p) => {
      const leaf = $(`.bookpage[data-page="${p}"]`, flipbook);
      if (!leaf) return;
      $$('.crew-reaction', leaf).forEach((el) => {
        out.push({
          who: el.dataset.who || '旁白',
          color: el.dataset.color || '#888',
          text: el.textContent.trim(),
        });
      });
    });
    return out;
  }

  /* ================================================================
   模块 5：渲染浮层
   —— v1.8：crew 气泡右侧 SuperChat 式逐条滑入，出现 5s 后逐个带退场动画滑出；
      旁白气泡左下角，出现 10s 后消失（两条时长独立可调）
   ================================================================ */
  const CHAT_LINGER = 5000; // crew 气泡停留时长：出现后 5s 逐个退场滑出（星羽要求）
  const NARR_LINGER = 10000; // 旁白停留时长：出现后 10s 消失（未特别要求，保持原值，要改就改这里）
  const BUBBLE_STEP = 700; // 每条气泡间隔
  const BUBBLE_FIRST = 500; // 首条延迟

  let appearTimers = []; // 逐条出现的定时器
  let removeTimers = []; // 每条气泡到时后触发退场的定时器
  function clearChat() {
    appearTimers.forEach((t) => clearTimeout(t));
    appearTimers = [];
    removeTimers.forEach((t) => clearTimeout(t));
    removeTimers = [];
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
    // 这条 crew 气泡出现后 5s 播放退场动画（右滑淡出），动画结束再移除
    removeTimers.push(
      setTimeout(() => {
        bubble.classList.add('chat-out');
        setTimeout(() => bubble.remove(), 350); // 与 .chat-out 动画时长一致
      }, CHAT_LINGER),
    );
  }
  function appendNarration(text) {
    const b = document.createElement('div');
    b.className = 'narr-bubble';
    b.textContent = text;
    narrLayer.appendChild(b);
    // 这条旁白气泡出现后 10s 自动消失
    removeTimers.push(setTimeout(() => b.remove(), NARR_LINGER));
  }
  // 翻到某跨页：清空 → 渲染旁白 + 逐条流出 crew（crew 5s 后逐个退场）
  function renderSpread(pageIndices) {
    clearChat();
    if (!pageIndices || !pageIndices.length) return;
    // 旁白（合并该跨页两页，按页码升序）
    getNarration(pageIndices.slice().sort((a, b) => a - b)).forEach((t) =>
      appendNarration(t),
    );
    // crew（逐条从右滑入，每条出现 5s 后退场滑出）
    const crew = getCrew(pageIndices);
    crew.forEach((item, i) => {
      appearTimers.push(
        setTimeout(() => appendBubble(item), BUBBLE_FIRST + i * BUBBLE_STEP),
      );
    });
  }

  /* ================================================================
   模块 6：翻书点击（双页 booklet 引擎）
   —— HTML 叶子顺序：back(idx偶, 左页) + front(idx奇, 右页) 交替配对
   —— 点 front(右页) → 往前翻到下一对；点 back(左页) → 往回翻到上一对
   —— 末对右页点击 → 合书回第一对
   —— 当前对由 currentPair 跟踪；显示切换由 showPair() 控制
   ================================================================ */
  let currentPair = 0;
  const totalPairs = Math.ceil((flipbook ? flipbook.querySelectorAll('.bookpage').length : 0) / 2);

  function initFlipClick() {
    if (!flipbook) return;
    flipbook.addEventListener('click', function (e) {
      // 单页模式自己处理
      if (window.innerWidth <= 720) return;
      const page = e.target.closest('.bookpage');
      if (!page) return;
      e.stopPropagation();
      const pages = Array.from(flipbook.children);
      const idx = pages.indexOf(page);
      if (idx === -1) return;
      const pairIdx = Math.floor(idx / 2);
      // 只响应当前对的页（其他对 opacity:0+pointerEvents:none 已经拦了）
      if (pairIdx !== currentPair) return;
      const isFront = idx % 2 === 1;
      const lastPair = totalPairs - 1;
      let nextPair;
      if (isFront) {
        if (pairIdx === lastPair) {
          // 末对右页 → 合书回第一对
          nextPair = 0;
        } else {
          nextPair = pairIdx + 1;
        }
      } else {
        // 点 back(左页) → 往回翻
        if (pairIdx === 0) return; // 第一对左页已无前页
        nextPair = pairIdx - 1;
      }
      currentPair = nextPair;
      showPair(nextPair);
      // 渲染该对两页的旁白+crew
      const idxs = [nextPair * 2, nextPair * 2 + 1].filter((i) => i < pages.length);
      renderSpread(idxs.map((i) => Number(pages[i].dataset.page)));
    });
  }

  /* ================================================================
   模块 6：单页模式（窄屏 ≤720px，独立于 booklet 双页引擎）
   —— 9 次点击 = 9 页（封面 / 签名 / 门票 / 克莉缇 / 天降 / 插图 / 他又赢 / 奥秘卡 / 卌卌卌）
   —— 翻页动画 = 当前页 rotateY(-180deg) 真立体翻走（与双页同款 3D 翻转）
   —— 下一页 opacity: 1 直接露出（不半透明、不淡入）
   —— 末页 → 合书回封面（与双页末页动作一致）
   ================================================================ */
  const singlePage = (function () {
    let list = []; // 按 data-page 升序的 9 张页
    let cur = 0; // 当前页下标（0~8）
    let busy = false; // 翻页动画进行中，防连点
    const DUR = 800; // 与 CSS .bookpage transition 0.8s 匹配

    function getSorted() {
      const arr = $$('.bookpage', flipbook);
      arr.sort((a, b) => Number(a.dataset.page) - Number(b.dataset.page));
      return arr;
    }

    function init() {
      list = getSorted();
      cur = 0;
      busy = false;
      // 清掉 booklet 留下的所有类 + 内联样式
      list.forEach((p, i) => {
        p.classList.remove('flipped', 'clickable', 'flipping', 'flipped-back');
        p.style.zIndex = '';
      });
      show(0);
    }

    function show(idx) {
      list.forEach((p, i) => {
        p.classList.remove('active', 'flipping', 'flipped-back');
        if (i === idx) p.classList.add('active');
      });
      cur = idx;
      busy = false;
      // 渲染当前页的旁白 + crew 气泡（与双页共用 renderSpread）
      renderSpread([idx]);
    }

    function next() {
      if (busy) return;
      if (cur >= list.length - 1) {
        // 末页：合书回封面（与双页末页动作一致，不关闭弹层）
        busy = true;
        const last = list[cur];
        last.classList.add('flipped-back'); // 末页合上动画
        // 同时下一帧激活第 0 页（从底下露出）
        requestAnimationFrame(() => {
          list[0].classList.add('active');
        });
        setTimeout(() => {
          last.classList.remove('active', 'flipped-back');
          show(0);
        }, DUR);
        return;
      }
      busy = true;
      const current = list[cur];
      const nxt = list[cur + 1];
      current.classList.add('flipping'); // 当前页 rotateY(-180) 翻走
      // 下一帧激活下一页（opacity 1 直接露在底下，不半透明）
      requestAnimationFrame(() => {
        nxt.classList.add('active');
      });
      setTimeout(() => {
        current.classList.remove('active', 'flipping');
        cur = cur + 1;
        busy = false;
        renderSpread([cur]);
      }, DUR);
    }

    function bindClick() {
      if (!flipbook) return;
      flipbook.addEventListener('click', function (e) {
        // 单页模式才响应
        if (window.innerWidth > 720) return;
        const page = e.target.closest('.bookpage');
        if (!page) return;
        if (!page.classList.contains('active')) return; // 只点当前可见页才翻
        e.stopPropagation();
        next();
      });
    }

    return { init, bindClick };
  })();

  /* ================================================================
   模块 7：打开 / 关闭
   ================================================================ */
  function openModal() {
    if (!modal || !flipbook) return;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    // 每次打开都重置到初始态：视口 ≤720 走单页，>720 走双页 booklet
    const pages = Array.from(flipbook.children);
    pages.forEach((p) =>
      p.classList.remove(
        'flipped',
        'clickable',
        'active',
        'flipping',
        'flipped-back',
      ),
    );
    flipbook.classList.remove('opened', 'unrolled');
    if (window.innerWidth <= 720) {
      singlePage.init(); // 单页独立状态机（9 次点击 = 9 页）
    } else {
      initBook();        // 双页：设 z-index
      currentPair = 0;   // 重置当前对
      showPair(0);       // 显示第一对（child1 左 + child2 右），隐藏其他
      renderSpread([0, 1]); // 渲染第一对的旁白+crew
    }
  }
  function closeModal() {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    clearChat();
  }

  /* ================================================================
   模块 8：绑定触发
   ================================================================ */
  initBook();
  initFlipClick();
  singlePage.bindClick(); // 单页点击监听（内部用 innerWidth 判断是否启用）
  $('#bookTrigger').addEventListener('click', openModal);
  $('#bookClose').addEventListener('click', closeModal);
  $('.book-backdrop', modal).addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) closeModal();
  });

  /* ============================================================
       2. 顶层场景证词手风琴
       ============================================================ */
  function initAccordion() {
    const sceneOptions = $$('details.scene-option');
    sceneOptions.forEach((details) => {
      details.addEventListener('toggle', () => {
        if (!details.open) return;
        sceneOptions.forEach((other) => {
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
  (function () {
    // 打字机设置（可调）
    const SPEED_IN = 16;
    const SPEED_OUT = 5;

    // 每个组独立的 token 管理
    const groupTokens = new WeakMap();

    // ----- 打字机核心（与之前逻辑相同，但针对单个输出容器）-----
    function type(out, paras, my) {
      let pi = 0,
        ci = 0;
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
          pi++;
          ci = 0;
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
        if (ps.length === 0) {
          done();
          return;
        }
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
      const paras = Array.from(frag.querySelectorAll('p')).map(
        (p) => p.textContent,
      );
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
    document.querySelectorAll('.choice-group').forEach((group) => {
      // 为组内每个 radio 绑定 change 事件
      const radios = group.querySelectorAll('input[type="radio"]');
      const out = group.querySelector('.branch-output');
      if (!out) return;
      // 初始化 token
      groupTokens.set(out, 0);

      radios.forEach((radio) => {
        radio.addEventListener('change', function (e) {
          if (!this.checked) return;
          const branch = this.value; // 'a' 或 'b'
          switchBranch(out, branch);
        });
      });
    });
  })();

  /* ============================================================
       4. bubble mouseover 点击/触摸展开 + 智能定位
       ============================================================ */
  document.addEventListener('mouseover', function (e) {
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
  const maskOverlay = document.getElementById('maskOverlay');
  const passInput = document.getElementById('passInput');

  passInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (passInput.value.trim() === 'yes,continue') {
        maskOverlay.style.display = 'none';
      }
    }
  });

  /* ============================================================
       初始化入口
       ============================================================ */
  // 各模块自启动
  // 直接执行
  initAccordion();
})();
