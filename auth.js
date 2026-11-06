/**
 * 登录 / 注册 / 会话保持 / 个人资料 / 注销账号 / 下载鉴权
 * 依赖：@supabase/supabase-js CDN、supabase-config.js
 */
(function () {
    'use strict';

    const cfg = window.SUPABASE_CONFIG;

    // SDK 或配置缺失时（多半是 CDN 没加载成功）仍然显示登录入口，提交时给出提示
    if (!cfg || !cfg.url || !cfg.publishableKey || !window.supabase) {
        const box = document.getElementById('nav-account');
        if (box) {
            const login = document.createElement('a');
            login.href = '#login';
            login.className = 'nav-link';
            login.dataset.page = 'login';
            login.textContent = '登录';
            box.appendChild(login);
        }
        document.querySelectorAll('.auth-form').forEach(function (form) {
            form.addEventListener('submit', function (e) {
                e.preventDefault();
                const el = form.querySelector('.auth-msg');
                if (el) {
                    el.textContent = '登录服务加载失败，请检查网络后刷新页面';
                    el.dataset.state = 'error';
                }
            });
        });
        return;
    }

    const sb = window.supabase.createClient(cfg.url, cfg.publishableKey);

    const accountBox = document.getElementById('nav-account');
    const navProfile = document.getElementById('nav-profile');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const profileForm = document.getElementById('profile-form');
    const deleteForm = document.getElementById('delete-form');
    const avatarButton = document.getElementById('avatar-pick');
    const avatarInput = document.getElementById('avatar-file');
    const avatarImg = document.getElementById('profile-avatar-img');
    const avatarFallback = document.getElementById('profile-avatar-fallback');
    const profileNameEl = document.getElementById('profile-name');
    const profileEmailEl = document.getElementById('profile-email');
    const downloadButton = document.getElementById('download-latest');
    const downloadMsg = document.getElementById('download-msg');

    // 好友与聊天
    const navFriends = document.getElementById('nav-friends');
    const friendsBadge = document.getElementById('friends-badge');
    const friendsView = document.getElementById('friends-view');
    const chatView = document.getElementById('chat-view');
    const friendSearchForm = document.getElementById('friend-search-form');
    const friendSearchMsg = document.getElementById('friend-search-msg');
    const friendResultsWrap = document.getElementById('friend-results-wrap');
    const friendResultsBox = document.getElementById('friend-results');
    const friendRequestsWrap = document.getElementById('friend-requests-wrap');
    const friendRequestsBox = document.getElementById('friend-requests');
    const friendsListBox = document.getElementById('friends-list');
    const friendsEmpty = document.getElementById('friends-empty');
    const chatBackBtn = document.getElementById('chat-back');
    const chatAvatar = document.getElementById('chat-avatar');
    const chatName = document.getElementById('chat-name');
    const chatScroll = document.getElementById('chat-scroll');
    const chatMessagesBox = document.getElementById('chat-messages');
    const chatEmpty = document.getElementById('chat-empty');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const chatMsg = document.getElementById('chat-msg');
    const chatAttachBtn = document.getElementById('chat-attach');
    const chatFileInput = document.getElementById('chat-file');
    const chatAttachBar = document.getElementById('chat-attach-bar');
    const chatAttachName = document.getElementById('chat-attach-name');
    const chatAttachClear = document.getElementById('chat-attach-clear');
    const chatBlockBtn = document.getElementById('chat-block');
    const chatReportBtn = document.getElementById('chat-report');
    const blockedWrap = document.getElementById('blocked-wrap');
    const blockedListBox = document.getElementById('blocked-list');
    // 他人资料页
    const userAvatarImg = document.getElementById('user-avatar-img');
    const userAvatarFallback = document.getElementById('user-avatar-fallback');
    const userNameEl = document.getElementById('user-name');
    const userEmailEl = document.getElementById('user-email');
    const userAddBtn = document.getElementById('user-add-friend');
    const userMsg = document.getElementById('user-msg');

    // 社区
    const communityForm = document.getElementById('community-form');
    const communityInput = document.getElementById('community-input');
    const communityCount = document.getElementById('community-count');
    const communityMsg = document.getElementById('community-msg');
    const communityFeed = document.getElementById('community-feed');
    const communityEmpty = document.getElementById('community-empty');
    const communityGuest = document.getElementById('community-guest');
    const communityMain = document.getElementById('community-main');
    const communityDetailEmpty = document.getElementById('community-detail-empty');
    const communityDetailBody = document.getElementById('community-detail-body');
    const communityAttachBtn = document.getElementById('community-attach');
    const communityFileInput = document.getElementById('community-file');
    const communityAttachName = document.getElementById('community-attach-name');
    const communityAttachList = document.getElementById('community-attach-list');
    const communitySortSelect = document.getElementById('community-sort');
    const communityMoreBtn = document.getElementById('community-more');
    const communityBookmarkFilter = document.getElementById('community-bookmark-filter');

    const AVATAR_BUCKET = 'avatars';
    const AVATAR_MAX_SIZE = 2 * 1024 * 1024;
    const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

    // 社区动态和聊天共用的图片/视频存储桶
    const MEDIA_BUCKET = 'media';
    const MEDIA_MAX_SIZE = 25 * 1024 * 1024;

    // 社区列表首屏只加载 20 条，滚动到底再追加
    const COMMUNITY_PAGE_SIZE = 20;

    let currentUser = null;
    let currentProfile = null;

    let friends = [];            // [{ id, nickname, avatar_url, updated_at }]
    let pendingRequests = [];    // [{ id, from_id, nickname, avatar_url, updated_at }]
    let pendingOutgoing = {};    // to_id -> true
    let searchResults = [];
    let activeFriend = null;
    let viewedUser = null;       // 正在查看的他人资料
    let unreadByFriend = {};     // friend_id -> 未读条数
    let realtimeChannel = null;
    let blockedUsers = [];       // 黑名单 [{ id, nickname, avatar_url }]
    let profileCache = {};       // 用户资料内存缓存 id -> { at, data }
    let commentCache = {};       // 帖子评论缓存 post_id -> { at, rows, authors }
    const PROFILE_CACHE_TTL = 5 * 60 * 1000;
    const COMMENT_CACHE_TTL = 60 * 1000;
    let chatKeyCache = {};       // friend_id -> AES-GCM CryptoKey
    let localKeyPair = null;     // 本机 ECDH 密钥对
    let chatFile = null;         // 待发送的图片/视频

    // 社区
    let communityPosts = [];
    let communityRequestId = 0;
    let communityLoadedAt = 0;
    let activeCommunityPostId = null;
    let communityFiles = [];     // 待发布的图片/视频（最多 9 个）
    let communitySort = 'new';   // new / old / hot / cold
    let communityBookmarkOnly = false;  // 只看自己收藏的帖子
    let communityHasMore = false;       // 是否还有更早的帖子
    let communityLoadingMore = false;   // 防止滚动重复触发

    function goPage(name) {
        if (window.SilguSite && typeof window.SilguSite.showPage === 'function') {
            window.SilguSite.showPage(name);
        } else {
            location.hash = name;
        }
    }

    function showMessage(form, text, state) {
        if (!form) return;
        const el = form.querySelector('.auth-msg');
        if (!el) return;
        el.textContent = text || '';
        el.dataset.state = text ? (state || 'error') : '';
    }

    function translateError(message) {
        if (/Invalid login credentials/i.test(message)) return '邮箱或密码错误';
        if (/Email not confirmed/i.test(message)) return '邮箱还没验证，请先完成邮箱验证';
        if (/User already registered|already confirmed/i.test(message)) return '这个邮箱已经注册过了，请直接登录';
        if (/Password should be at least/i.test(message)) return '密码至少 6 位';
        if (/Unable to validate email/i.test(message)) return '邮箱格式不正确';
        if (/Token has expired|expired or is invalid|invalid.*token/i.test(message)) return '验证码已过期，请重新发送';
        if (/Token.*not found|otp.*not found/i.test(message)) return '验证码不正确，请检查后重试';
        if (/rate limit|too many/i.test(message)) return '操作太频繁，稍后再试';
        if (/Failed to fetch/i.test(message)) return '连不上服务器，检查网络后重试';
        if (/Bucket not found/i.test(message)) return '头像存储桶不存在，请先完成数据库初始化';
        if (/permission denied/i.test(message)) return '数据库权限没配置好，请先执行授权脚本';
        if (/row-level security/i.test(message)) return '没有权限执行这个操作，请先完成数据库初始化';
        if (/does not exist/i.test(message)) return '数据库还没初始化，请先在 Supabase 执行初始化脚本';
        return message;
    }

    // 好友相关操作的错误提示，补上「可能还没执行初始化脚本」的指引
    function socialError(err) {
        const message = (err && err.message) || '';
        if (/Could not find the function|does not exist|schema cache/i.test(message)) {
            return '好友功能还没初始化，请先在 Supabase 执行好友初始化脚本';
        }
        if (/duplicate key/i.test(message)) return '已经发过申请了，等对方处理吧';
        return translateError(message);
    }

    function displayNameOf(user) {
        const name = ((user && user.email) || '').split('@')[0];
        return name || '玩家';
    }

    function nicknameOf() {
        if (currentProfile && currentProfile.nickname) return currentProfile.nickname;
        return displayNameOf(currentUser);
    }

    function initialOf() {
        return (nicknameOf() || '?').trim().charAt(0).toUpperCase();
    }

    // 头像地址带上资料更新时间，覆盖上传后不会读到浏览器旧缓存
    function avatarSrc() {
        if (!currentProfile || !currentProfile.avatar_url) return '';
        const base = currentProfile.avatar_url;
        const stamp = currentProfile.updated_at ? new Date(currentProfile.updated_at).getTime() : 0;
        return base + (base.indexOf('?') >= 0 ? '&' : '?') + 't=' + stamp;
    }

    function renderAccount() {
        if (!accountBox) return;
        accountBox.textContent = '';

        if (navProfile) navProfile.hidden = !currentUser;
        if (navFriends) navFriends.hidden = !currentUser;
        renderBadge();

        if (currentUser) {
            const avatar = document.createElement('a');
            avatar.href = '#profile';
            avatar.className = 'nav-avatar';
            avatar.title = '个人资料';
            avatar.setAttribute('aria-label', '个人资料');
            avatar.addEventListener('click', function (e) {
                e.preventDefault();
                goPage('profile');
            });

            const src = avatarSrc();
            if (src) {
                const img = document.createElement('img');
                img.src = src;
                img.alt = '';
                avatar.appendChild(img);
            } else {
                avatar.textContent = initialOf();
            }

            // 头像右侧显示昵称，点它也能进入个人资料
            const name = document.createElement('a');
            name.href = '#profile';
            name.className = 'nav-account__name';
            name.title = '个人资料';
            name.textContent = nicknameOf();
            name.addEventListener('click', function (e) {
                e.preventDefault();
                goPage('profile');
            });

            const logout = document.createElement('button');
            logout.type = 'button';
            logout.className = 'nav-link nav-account__logout';
            logout.dataset.action = 'logout';
            logout.textContent = '退出';

            accountBox.append(avatar, name, logout);
            return;
        }

        const login = document.createElement('a');
        login.href = '#login';
        login.className = 'nav-link';
        login.dataset.page = 'login';
        login.textContent = '登录';
        accountBox.appendChild(login);
    }

    function renderProfilePage() {
        if (!profileForm) return;

        if (!currentUser) {
            if (profileNameEl) profileNameEl.textContent = '';
            if (profileEmailEl) profileEmailEl.textContent = '';
            if (profileForm.nickname) profileForm.nickname.value = '';
            return;
        }

        const src = avatarSrc();

        if (avatarFallback) avatarFallback.textContent = initialOf();

        if (avatarImg) {
            if (src) {
                avatarImg.src = src;
                avatarImg.hidden = false;
                if (avatarFallback) avatarFallback.hidden = true;
            } else {
                avatarImg.hidden = true;
                avatarImg.removeAttribute('src');
                if (avatarFallback) avatarFallback.hidden = false;
            }
        }

        if (profileNameEl) profileNameEl.textContent = nicknameOf();
        if (profileEmailEl) profileEmailEl.textContent = currentUser.email || '';
        if (profileForm.nickname) profileForm.nickname.value = nicknameOf();
    }

    async function loadProfile(user) {
        if (!user) {
            currentProfile = null;
            return;
        }

        try {
            const result = await sb
                .from('profiles')
                .select('nickname, avatar_url, updated_at, public_key')
                .eq('id', user.id)
                .maybeSingle();

            if (result.error) throw result.error;

            if (result.data) {
                currentProfile = result.data;
                cacheSelfProfile();
                return;
            }

            // 触发器没建好时兜底：第一次登录顺手补一条资料
            const nickname = displayNameOf(user);
            const inserted = await sb
                .from('profiles')
                .insert({ id: user.id, nickname: nickname })
                .select('nickname, avatar_url, updated_at, public_key')
                .maybeSingle();

            currentProfile = inserted.data || {
                nickname: nickname,
                avatar_url: null,
                updated_at: null,
                public_key: null
            };
            cacheSelfProfile();
        } catch (err) {
            currentProfile = {
                nickname: displayNameOf(user),
                avatar_url: null,
                updated_at: null,
                public_key: null
            };
            cacheSelfProfile();
            console.warn('读取个人资料失败：', err);
        }
    }

    async function syncUser(user) {
        const previousId = currentUser ? currentUser.id : null;
        currentUser = user || null;
        await loadProfile(currentUser);
        renderAccount();
        renderProfilePage();
        renderCommunityState();

        // 登录状态变化时重新加载好友数据、重建实时订阅
        const currentId = currentUser ? currentUser.id : null;
        if (currentId !== previousId) {
            stopRealtime();
            chatKeyCache = {};
            localKeyPair = null;
            if (currentId) {
                startRealtime();
                publishPublicKey();
            }
            refreshSocial();
            communityLoadedAt = 0;
            loadCommunity();
        }

        // 退出后仍停在需要登录的页面时回到登录页
        if (!currentUser && (location.hash === '#profile' || location.hash === '#friends')) {
            goPage('login');
        }
    }

    if (accountBox) {
        accountBox.addEventListener('click', function (e) {
            if (e.target.closest('[data-action="logout"]')) {
                e.preventDefault();
                sb.auth.signOut();
            }
        });
    }

    if (loginForm) {
        loginForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            const email = loginForm.email.value.trim();
            const password = loginForm.password.value;
            const submit = loginForm.querySelector('button[type="submit"]');

            showMessage(loginForm, '');
            submit.disabled = true;
            submit.textContent = '登录中…';

            const result = await sb.auth.signInWithPassword({ email, password });

            submit.disabled = false;
            submit.textContent = '登录';

            if (result.error) {
                if (/Email not confirmed/i.test(result.error.message)) {
                    showMessage(loginForm, '邮箱还没验证，请到注册页重新发送验证码');
                    goPage('register');
                    if (registerForm) {
                        registerForm.email.value = email;
                        registerForm.password.focus();
                    }
                    return;
                }
                showMessage(loginForm, translateError(result.error.message));
                return;
            }

            loginForm.reset();
            goPage('home');
        });
    }

    if (registerForm) {
        const sendBtn = document.getElementById('send-code');
        const tokenInput = registerForm.querySelector('input[name="token"]');
        let sentEmail = '';
        let countdown = 0;
        let timer = null;

        function checkFields() {
            const email = registerForm.email.value.trim();
            const password = registerForm.password.value;
            const confirm = registerForm.confirm.value;

            if (!/^\S+@\S+\.\S+$/.test(email)) {
                showMessage(registerForm, '邮箱格式不正确');
                return null;
            }
            if (password.length < 6) {
                showMessage(registerForm, '密码至少 6 位');
                return null;
            }
            if (password !== confirm) {
                showMessage(registerForm, '两次输入的密码不一致');
                return null;
            }
            return { email: email, password: password };
        }

        function startCountdown() {
            countdown = 60;
            sendBtn.disabled = true;
            sendBtn.textContent = countdown + ' 秒后可重发';
            timer = setInterval(function () {
                countdown -= 1;
                if (countdown > 0) {
                    sendBtn.textContent = countdown + ' 秒后可重发';
                    return;
                }
                clearInterval(timer);                timer = null;
                sendBtn.disabled = false;
                sendBtn.textContent = '重新发送';
            }, 1000);
        }
