/**
 * 星空背景动画
 * 生成静态星星 + 光晕效果，模拟深邃宇宙
 * 星星根据鼠标位置产生视差移动
 */
(function () {
    const canvas = document.getElementById('stars-canvas');
    const ctx = canvas.getContext('2d');

    let stars = [];
    let shootingStars = [];
    let width = 0;
    let height = 0;

    // 星星配置
    const STAR_COUNT = 220;       // 普通星星数量
    const GLOW_STAR_COUNT = 8;    // 带光晕的亮星
    const SHOOTING_STAR_INTERVAL = 4000; // 流星生成间隔

    // 视差配置
    const MAX_PARALLAX = 46;   // 最大位移（像素）
    const EASE = 0.08;         // 缓动系数，越小越柔滑

    // 鼠标位置（归一化 -1 ~ 1），current 为缓动后的实际值
    const pointer = {
        x: 0, y: 0,
        targetX: 0, targetY: 0
    };

    let nebula = { cx: 0, cy: 0, rx: 0, ry: 0 };

    // 调整画布尺寸
    function resize() {
        const dpr = window.devicePixelRatio || 1;
        width = window.innerWidth;
        height = window.innerHeight;

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        ctx.scale(dpr, dpr);

        generateStars();
    }

    // 生成星星
    function generateStars() {
        stars = [];
        shootingStars = [];

        // 普通星星（小点）
        for (let i = 0; i < STAR_COUNT; i++) {
            const near = Math.random() < 0.08; // 少量近景星星，移动更明显
            stars.push({
                x: Math.random() * width,
                y: Math.random() * height,
                r: near ? Math.random() * 1.6 + 0.9 : Math.random() * 1.2 + 0.3,
                depth: near ? Math.random() * 0.5 + 0.5 : Math.random() * 0.35 + 0.05,
                baseAlpha: Math.random() * 0.6 + 0.3,
                alpha: Math.random() * 0.6 + 0.3,
                twinkleSpeed: Math.random() * 0.015 + 0.005,
                twinklePhase: Math.random() * Math.PI * 2,
                type: 'normal'
            });
        }

        // 带光晕的亮星
        for (let i = 0; i < GLOW_STAR_COUNT; i++) {
            stars.push({
                x: Math.random() * width,
                y: Math.random() * height,
                r: Math.random() * 1.5 + 1.5,
                glowR: Math.random() * 25 + 15,
                depth: Math.random() * 0.4 + 0.3,
                baseAlpha: Math.random() * 0.5 + 0.5,
                alpha: 1,
                twinkleSpeed: Math.random() * 0.008 + 0.003,
                twinklePhase: Math.random() * Math.PI * 2,
                type: 'glow'
            });
        }

        // 中心星云暗区参数
        nebula = {
            cx: width / 2,
            cy: height / 2,
            rx: width * 0.28,
            ry: height * 0.22
        };
    }

    // 计算某颗星星因鼠标位置产生的偏移
    function parallaxOffset(depth) {
        return {
            dx: -pointer.x * MAX_PARALLAX * depth,
            dy: -pointer.y * MAX_PARALLAX * depth
        };
    }

    // 绘制单颗星星
    function drawStar(star) {
        // 闪烁动画
        star.twinklePhase += star.twinkleSpeed;
        star.alpha = star.baseAlpha * (0.6 + 0.4 * Math.sin(star.twinklePhase));

        const { dx, dy } = parallaxOffset(star.depth);
        const x = star.x + dx;
        const y = star.y + dy;

        ctx.save();
        ctx.globalAlpha = star.alpha;

        if (star.type === 'glow') {
            // 带光晕的亮星
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, star.glowR);
            gradient.addColorStop(0, 'rgba(200, 220, 255, 0.9)');
            gradient.addColorStop(0.2, 'rgba(150, 180, 230, 0.4)');
            gradient.addColorStop(0.5, 'rgba(100, 130, 180, 0.15)');
            gradient.addColorStop(1, 'rgba(80, 100, 150, 0)');

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, star.glowR, 0, Math.PI * 2);
            ctx.fill();

            // 星心
            ctx.fillStyle = 'rgba(240, 245, 255, 0.95)';
            ctx.beginPath();
            ctx.arc(x, y, star.r * 0.7, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // 普通星星
            ctx.fillStyle = 'rgba(220, 230, 255, 1)';
            ctx.beginPath();
            ctx.arc(x, y, star.r, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    // 绘制中心星云暗区（视差幅度更小，形成层次感）
    function drawNebula() {
        const { dx, dy } = parallaxOffset(0.25);
        const cx = nebula.cx + dx;
        const cy = nebula.cy + dy;

        // 椭圆形暗区
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(nebula.rx, nebula.ry));
        gradient.addColorStop(0, 'rgba(5, 10, 20, 0.7)');
        gradient.addColorStop(0.5, 'rgba(8, 15, 28, 0.4)');
        gradient.addColorStop(1, 'rgba(10, 18, 32, 0)');

        ctx.save();
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.ellipse(cx, cy, nebula.rx, nebula.ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // 绘制流星
    function createShootingStar() {
        const startX = Math.random() * width * 0.6;
        const startY = Math.random() * height * 0.4;
        const angle = Math.PI / 4 + (Math.random() - 0.5) * 0.3;
        const speed = Math.random() * 8 + 10;

        shootingStars.push({
            x: startX,
            y: startY,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            speed: speed,
            length: Math.random() * 80 + 60,
            alpha: 1,
            decay: Math.random() * 0.012 + 0.008
        });
    }

    function drawShootingStars() {
        for (let i = shootingStars.length - 1; i >= 0; i--) {
            const s = shootingStars[i];

            // 更新位置
            s.x += s.vx;
            s.y += s.vy;
            s.alpha -= s.decay;

            // 绘制流星
            if (s.alpha > 0) {
                const tailX = s.x - s.vx * (s.length / s.speed);
                const tailY = s.y - s.vy * (s.length / s.speed);

                const gradient = ctx.createLinearGradient(s.x, s.y, tailX, tailY);
                gradient.addColorStop(0, `rgba(255, 255, 255, ${s.alpha})`);
                gradient.addColorStop(0.3, `rgba(200, 220, 255, ${s.alpha * 0.6})`);
                gradient.addColorStop(1, 'rgba(150, 180, 230, 0)');

                ctx.save();
                ctx.strokeStyle = gradient;
                ctx.lineWidth = 1.5;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(s.x, s.y);
                ctx.lineTo(tailX, tailY);
                ctx.stroke();
                ctx.restore();
            }

            // 移除已消失或超出屏幕的流星
            if (s.alpha <= 0 || s.x > width + 100 || s.y > height + 100) {
                shootingStars.splice(i, 1);
            }
        }
    }

    // 主循环
    function animate() {
        // 缓动跟随鼠标，避免突变
        pointer.x += (pointer.targetX - pointer.x) * EASE;
        pointer.y += (pointer.targetY - pointer.y) * EASE;

        ctx.clearRect(0, 0, width, height);

        // 先画星云暗区
        drawNebula();

        // 画所有星星
        for (const star of stars) {
            drawStar(star);
        }

        // 画流星
        drawShootingStars();

        requestAnimationFrame(animate);
    }

    // 记录鼠标位置（归一化到 -1 ~ 1）
    function updatePointer(clientX, clientY) {
        pointer.targetX = (clientX / width - 0.5) * 2;
        pointer.targetY = (clientY / height - 0.5) * 2;
    }

    window.addEventListener('mousemove', (e) => {
        updatePointer(e.clientX, e.clientY);
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        const t = e.touches[0];
        if (t) updatePointer(t.clientX, t.clientY);
    }, { passive: true });

    // 鼠标离开窗口时缓慢回到中心
    window.addEventListener('mouseleave', () => {
        pointer.targetX = 0;
        pointer.targetY = 0;
    });

    window.addEventListener('blur', () => {
        pointer.targetX = 0;
        pointer.targetY = 0;
    });

    // 启动
    resize();
    animate();

    // 定时生成流星
    setInterval(createShootingStar, SHOOTING_STAR_INTERVAL);

    // 响应窗口大小变化
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(resize, 150);
    });
})();

/**
 * 首页 / 下载页切换
 */
(function () {
    const pages = document.querySelectorAll('.page');
    const links = document.querySelectorAll('[data-page]');

    const PAGE_NAMES = ['home', 'download', 'versions', 'login', 'register', 'verify', 'profile', 'friends'];

    function showPage(name) {
        // 版本列表属于下载流程，导航高亮仍停在「下载」
        const navName = name === 'versions' ? 'download' : name;

        // 地址栏与当前页面保持一致，刷新后还能停在这一页
        if (location.hash.slice(1) !== name) {
            if (history.replaceState) {
                history.replaceState(null, '', '#' + name);
            } else {
                location.hash = name;
            }
        }

        pages.forEach((p) => {
            p.classList.toggle('page--active', p.id === 'page-' + name);
        });
        links.forEach((l) => {
            if (!l.classList.contains('nav-link')) return;
            l.classList.toggle('nav-link--active', l.dataset.page === navName);
        });

        // 通知其它模块页面已切换（例如好友页需要在进入时刷新数据）
        window.dispatchEvent(new CustomEvent('silgu:page', { detail: { name: name } }));
    }

    links.forEach((link) => {
        link.addEventListener('click', (e) => {
            const name = link.dataset.page;
            if (!name) return;
            e.preventDefault();
            showPage(name);
        });
    });

    // 初始页面：按地址栏 hash 决定，默认首页
    const initial = location.hash.slice(1);
    showPage(PAGE_NAMES.includes(initial) ? initial : 'home');

    // 供 auth.js 等模块切换页面
    window.SilguSite = { showPage };

    // 动态生成或直接修改 hash 的链接（例如登录/退出）也能切页
    window.addEventListener('hashchange', () => {
        const name = location.hash.slice(1);
        if (PAGE_NAMES.includes(name)) showPage(name);
    });
})();