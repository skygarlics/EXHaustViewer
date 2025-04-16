class EXHaustViewer {
    // Viewer elements
    iframe = null;
    iframe_jq = null;
    comicImages;
    thumbnailContainer;

    update_check = false;
    PanelListenerAdded = false;
    set_spread = 1;
    class_spread = 1;
    is_single_displayed = true;
    timerflag = false;
    timerInterval = null;
    renderType = -1; // make sure renderType start from 0
    fitType = -1;

    dragState = {
        isDragging: false,
        prevX: 0,
        prevY: 0
    };

    images = {}; // image datas. 0-indexed. {idx: {url, width, height, path, nl, updated}}
    thumbnails = {}; // thumbnail datas. {idx: element} // each element has data-idx attribute.

    curPanel = 1; // current panel number (1-indexed, always has to be integer)

    #number_of_images;
    get number_of_images() {
        return this.#number_of_images;
    }

    set number_of_images(value) {
        if (value < 1) {
            console.error("Invalid number of images:", value);
            return;
        }
        this.#number_of_images = value;
        this.createPageDropdown();
    }

    set_number_of_images(value, make_thumb) {
        this.number_of_images = value;
        if (make_thumb) {
            this.batchReplaceThumbnails(
                (function* () {for (let i = 1; i < value+1; i++) { yield i }})(),
                'empty_thumb'
            );
        }
    }

    #gallery_url;
    get gallery_url() {
        return this.#gallery_url;
    }
    set gallery_url(value) {
        this.#gallery_url = value;

        var gallery_info = this.iframe.contentDocument.getElementById('galleryInfo');
        if (!gallery_info) {
            return;
        }

        if (this.#gallery_url) {
            gallery_info.href = this.#gallery_url
        }
    }

    constructor(curPanel) {
        if (!curPanel) {
            curPanel = 1;
        }
        this.curPanel = curPanel;
        this.addIframe();
        this.iframe.onload = () => this.init();
    }

    async init() {
        this.body = this.iframe.contentDocument.body;
        this.renderStyle = this.addRenderStyle(this.iframe.contentDocument);
        this.comicImages = this.iframe.contentDocument.getElementById('comicImages');
        this.thumbnailContainer = this.iframe.contentDocument.getElementById('thumb_container');
        // prevent dropdown from close
        $('.dropdown-menu', this.iframe_jq.contents()).on('click', function(e) {
            e.stopPropagation();
        });

        this.iframe.contentDocument.body.setAttribute('class', 'spread1');
        //this.addStyle('div#i1 {display:none;} p.ip {display:none;}');

        this.addEventListeners(this.iframe.contentDocument);
        this.addFullscreenHandler(this.iframe.contentDocument);

        $('.navbar ul li', this.iframe_jq.contents()).show();
        $('#fullSpread', this.iframe_jq.contents()).hide();

        this.renderChange();
        this.changeFit();

        var docElm = this.iframe.contentDocument.documentElement;
        if (!docElm.requestFullscreen && !docElm.mozRequestFullScreen && !docElm.webkitRequestFullScreen && !docElm.msRequestFullscreen) {
            $('#fullscreen', this.iframe_jq.contents()).parent().hide();
        }

        $('#single-page-select', this.iframe_jq.contents()).prop('selectedIndex', this.curPanel - 1);
    }

    finally = this.pageChanged;

    // ==============  ==============
    // these functions can be overridden by nenecessary
    
    /**
     * Override to get current page by current image on original page
     * @returns {number} current page that Original page is showing
     *  */
    getPageFromOriginal = null;

    prevEpisode() {
        console.log("override required: prevEpisode()");
        return;
    }

    nextEpisode() {
        console.log("override required: nextEpisode()");
        return;
    }

    getReloadInfo = async (nl_url, path) => {
        return { path: path, nl_url: nl_url };
    };

    extractImageData = async (url, idx) => {
        // in default, it just return nothing
        return { path: url };
    }

    // ============== setup functions ==============
    saveConfig(key, value) {
        if (!GM_getValue) {
            console.error("GM_getValue is not defined. Cannot save config.");
            return false;
        }
        return GM_setValue(key, value);
    }

    loadConfig(key) {
        if (!GM_getValue) {
            console.error("GM_getValue is not defined. Cannot load config.");
            return null;
        }
        return GM_getValue(key);
    }

    addShowbutton(selector, elem_type, inner_html) {
        var elem_ = elem_type ? elem_type : 'a';
        var inner = inner_html ? inner_html : '<div style="font-size: 2em; user-select: none">🕮</div>';
        var target = document.querySelector(selector);

        var btn = document.createElement(elem_);
        btn.id = 'enableViewer';
        btn.innerHTML = inner;
        btn.onclick = ()=>this.toggleViewer();
        target.appendChild(btn);
    }

    // Viewer iframe
    addIframe() {
        var iframe = document.createElement('iframe');
        iframe.id = 'exhaustviewer';
        var src = document.location.href
        //iframe.src = src;

        iframe.style.position = 'fixed';
        iframe.style.top = '0';
        iframe.style.left = '0';
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframe.style.zIndex = '9999';
        iframe.style.display = 'none';

        // integrity problem?
        var bs_js;
        if (GM_getResourceText) {
            bs_js = GM_getResourceText('bs_js');
        } else {
            bs_js = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js';
        }

        iframe.srcdoc = `<!DOCTYPE html><html>
            <head>
                <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH" crossorigin="anonymous">
                <script>
                    ${bs_js}
                </script>
                <style>
                    ${this.viewer_style}
                    ${this.fullscreen_style}
                    ${this.makeDynamicStyles()}
                </style>
            </head>
            <body>
                ${this.navbarHTML}
                ${this.imgFrameHTML}
            </body></html>`;
        document.body.appendChild(iframe);
        this.iframe = iframe;
        this.iframe_jq = $(iframe);

        return iframe;
    }

    addRenderStyle(docu) {
        // Image rendering option. needs ID to render swap
        var parent = docu.head || docu.documentElement;
        var style = docu.createElement('style');
        style.type = 'text/css';
        var renderStyle = docu.createTextNode('');
        renderStyle.id = 'renderStyle';
        style.appendChild(renderStyle);
        parent.appendChild(style);
        return renderStyle;
    }

    addHTML(code) {
        var body = this.iframe.contentDocument.body;
        body.innerHTML += code;
    }

    createPageDropdown() {
        // clear previous dropdown
        $('#single-page-select', this.iframe_jq.contents()).empty();
        for (var i = 1; i <= this.number_of_images; i++) {
            var option = $('<option>', {
                html: '' + i,
                value: i
            });
            $('#single-page-select', this.iframe_jq.contents()).append(option);
        }
    }

    setGalleryTitle(text, title) {
        var gallery_info = this.iframe.contentDocument.getElementById('galleryInfo');
        if (gallery_info == null) {
            console.log("galleryInfo is null");
            return;
        }

        if (text) {
            gallery_info.textContent = text;
        }

        if (title) {
            gallery_info.title = title;
        }
    }

    addEventListeners(docu) {
        docu.addEventListener('keydown', (e) => this.doHotkey(e));
        docu.getElementById('centerer').addEventListener('wheel', (e) => {
            this.doWheel(e)
            // ensure wheel don't propagae to parent
            e.stopPropagation();
            e.preventDefault();
        }, { passive: false });
        docu.getElementById('prevPanel').addEventListener('click', ()=>this.prevPanel());
        docu.getElementById('nextPanel').addEventListener('click', ()=>this.nextPanel());
        docu.getElementById('fitChanger').addEventListener('click', () => this.changeFit());
        docu.getElementById('fullscreener').addEventListener('click', ()=>this.toggleFullscreen());
        docu.getElementById('fullSpread').addEventListener('click', ()=>this.setSpread(1));
        docu.getElementById('singlePage').addEventListener('click', ()=>this.setSpread(2));
        docu.getElementById('renderingChanger').addEventListener('click', () => this.renderChange());
        docu.getElementById('reload').addEventListener('click', ()=>this.reloadCurrentImg());
        docu.getElementById('preloader').addEventListener('click', ()=>this.preloader());
        docu.getElementById('autoPager').addEventListener('click', () => this.toggleTimer());
        docu.getElementById('pageChanger').addEventListener('click', () => this.goPanel());
        docu.getElementById('single-page-select').addEventListener('change', ()=>this.selectorChanged());
        
        docu.getElementById('comicImages').addEventListener('mousedown', (e) => this.imgDragStart(e));
        docu.getElementById('comicImages').addEventListener('mousemove', (e) => this.imgDrag(e));
        docu.getElementById('comicImages').addEventListener('mouseup', () => this.imgDragEnd());
        docu.getElementById('comicImages').addEventListener('touchstart', (e) => this.touchStart(e), {passive:false});
        docu.getElementById('comicImages').addEventListener('touchmove', (e) => this.touchDrag(e));
        docu.getElementById('comicImages').addEventListener('touchend', () => this.imgDragEnd());

        docu.getElementById('viewerCloser').addEventListener('click', () => this.closeViewer());
        docu.getElementById('galleryInfo').addEventListener('click', () => this.goGallery());

        docu.getElementById('fullscreen').addEventListener('click', ()=>this.toggleFullscreen());
        
        docu.getElementById('thumbnailModal').addEventListener('show.bs.modal', () => {
            setTimeout(() => {
                // Move the backdrop to the comicImages container; for fullscreen
                const backdrop = docu.querySelector('.modal-backdrop');
                if (backdrop) {
                    this.comicImages.appendChild(backdrop);
                }
            }, 0);
            
            setTimeout(() => {
                const curr = this.curPanel;
                const target_thumb = this.thumbnailContainer.querySelector(`#thumbnail_${curr - 1}`);
                if (target_thumb) {
                    target_thumb.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 150);
        });
        // docu.getElementById('addthumb').addEventListener('click', () => {
        //     var thumb_count = this.thumbnailContainer.childElementCount;
        //     var thumb_elem = docu.createElement('div');
        //     thumb_elem.textContent = 'Thumb ' + thumb_count;
        //     this.setThumbnail(thumb_count, thumb_elem)
        // });
    }

    // ============== Dangerous functions ==============
    // functions affects WHOLE page
    clearStyle() {
        for (var i = document.styleSheets.length - 1; i >= 0; i--) {
            document.styleSheets[i].disabled = true;
        }
        var arAllElements = (typeof document.all != 'undefined') ?
            document.all : document.getElementsByTagName('*');
        for (var i = arAllElements.length - 1; i >= 0; i--) {
            var elmOne = arAllElements[i];
            if (elmOne.nodeName.toUpperCase() == 'LINK') {
                // remove <style> elements defined in the page <head>
                elmOne.remove();
            }
        }
    }

    clearHotkeys() {
        // remove original events.
        document.onkeydown = null;
        document.onkeyup = null;
    }

    addStyle(css) {
        var doc = this.iframe.contentDocument;
        var parent = doc.head || doc.documentElement;
        var style = doc.createElement('style');
        style.type = 'text/css';
        var textNode = doc.createTextNode(css);
        style.appendChild(textNode);
        parent.appendChild(style);
    }

    // ============== Draw functions ==============
    drawPanel_() {
        const comicImagesContainer = $('#centerer', this.iframe.contentDocument);
        const currentPanel = this.curPanel;
        const totalImages = this.number_of_images;
        const singleSpread = this.set_spread === 1;

        // 기존 img 요소를 가져오거나 없는 경우 새로 추가
        let imgElements = comicImagesContainer.find('img');
        const requiredImageCount = singleSpread ? 1 : 2;

        while (imgElements.length < requiredImageCount) {
            $('<img />', this.iframe_jq.contents()).appendTo(comicImagesContainer);
            imgElements = comicImagesContainer.find('img'); // 추가 후 업데이트
        }

        if (!singleSpread && currentPanel > 1 && currentPanel < totalImages) {
            const nextImage = this.images[currentPanel];
            const currentImage = this.images[currentPanel - 1];

            // TODO : nextPanel, prevPanel에서도 계산되는거 제거하기?
            // normally 
            var hw_ratio = currentImage.height / currentImage.width;
            if (nextImage.width <= nextImage.height && hw_ratio > 1.2) {
                // two image
                this.setSpreadClass(2);
                var rt_img = $(imgElements[1]);
                rt_img.addClass('rt_img');
                var lt_img = $(imgElements[0]);
                lt_img.addClass('lt_img');

                this.showImage(rt_img, currentImage, currentPanel-1, currentPanel);
                this.showImage(lt_img, nextImage, currentPanel, currentPanel);
                this.is_single_displayed = false;
                this.preloadImage(3);
            } else {
                // single image
                this.setSpreadClass(1);
                this.showImage($(imgElements[0]), currentImage, currentPanel-1, currentPanel);
                $(imgElements[1]).remove(); // 두 번째 이미지가 필요하지 않을 경우 제거
                this.is_single_displayed = true;
                this.preloadImage(2);
            }
        } else if (currentPanel <= totalImages) {
            // single image
            this.setSpreadClass(1);
            this.showImage($(imgElements[0]), this.images[currentPanel-1], currentPanel-1, currentPanel);
            this.is_single_displayed = true;
            $(imgElements[1]).remove(); // 두 번째 이미지가 필요하지 않을 경우 제거
            this.preloadImage(2);
        }

        if (!this.PanelListenerAdded) {
            $('#leftBtn', this.iframe_jq.contents()).on('click', ()=>this.nextPanel());
            $('#rightBtn', this.iframe_jq.contents()).on('click', ()=>this.prevPanel());
            this.PanelListenerAdded = true;
        }

        comicImagesContainer.scrollTop(0);
        $('body', this.iframe_jq.contents()).scrollTop(0);
    };

    drawPanel() {
        var n_curPanel = this.curPanel;
        this.updageImgsRange(n_curPanel, n_curPanel+2)
        .then(()=>this.drawPanel_());
    };

    showImage(imgElement, imgObj, idx, curPanel) {
        var RETRY_LIMIT = 3;
        var retry_count = 0;

        // check if newSrc is undefined
        if (!imgObj.path) {
            return;
        }

        const tempImg = new Image();
        
        tempImg.onload = () => {
            var is_cur = this.curPanel == curPanel; // check if current panel is still same
            if (!is_cur) return;
            imgElement.attr('src', imgObj.path).css('opacity', '1');
        };
        
        tempImg.onerror = () => {
            console.error("Img load failed:", imgObj.path);
        };

        // imgElement.css('opacity', '0'); // 로드 중에는 투명하게 유지
        tempImg.src = imgObj.path;
            // 이미 캐시에 있는 경우 즉시 표시
        if (tempImg.complete) {
            imgElement.attr('src', imgObj.path).css('opacity', '1');
        } else {
            imgElement.css('opacity', '0'); // 로드 중에는 투명하게 유지
        }
    }

    // ============== Thumbnail functions ==============
    createThumbnailWrapper(idx, element, callback) {
        if (element == null || element === undefined) {
            console.error("Element is null or undefined:", element);
            return;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'thumbnail_wrapper';
        wrapper.id = 'thumbnail_' + idx;
        if (callback) {
            wrapper.addEventListener('click', () => {
                callback(idx);
            });
        } else {
            wrapper.addEventListener('click', () => {
                this.panelChange(idx + 1);
                const close_button = this.iframe.contentDocument.querySelector('.btn-close');
                if (close_button) {
                    close_button.click(); // Close the thumbnail modal
                }
            });
        }

        // if element type is string, then just set wrapper's innerHTML
        if (typeof element === 'string' || typeof element === 'number') {
            wrapper.innerHTML = element;
        } else {
            // element.setAttribute('data-idx', idx);
            wrapper.appendChild(element);
        }
        return wrapper;
    }

    batchReplaceThumbnails(elements, class_string, callback) {
        // empthy thumbnail
        this.thumbnailContainer.innerHTML = '';
        this.thumbnails = {};

        this.batchAddThumbnails(elements, class_string, callback);
    }

    batchAddThumbnails(elements, class_strings, callback) {
        if (!elements || typeof elements[Symbol.iterator] !== 'function') {
            console.error("elements is not iterable", elements);
            return;
        }
        const frag = this.iframe.contentDocument.createDocumentFragment();

        var idx = 0;
        for (const element of elements) {
            const wrapper = this.createThumbnailWrapper(idx, element, callback);
            if (class_strings) {
                wrapper.classList.add(...class_strings.split(' '));
            }
            this.thumbnails[idx] = wrapper;
            frag.appendChild(wrapper);
            idx++;
        }
        this.thumbnailContainer.appendChild(frag);
    }

    setThumbnail(idx, element, class_strings, force, callback) {
        const neww = this.createThumbnailWrapper(idx, element, callback);
        if (class_strings) {
            neww.classList.add(...class_strings.split(' '));
        }

        const oldw = this.thumbnailContainer.querySelector('#thumbnail_' + idx);

        if (oldw) {
            if (!force) {
                return; // Thumbnail already exists, no need to replace
            }
            this.thumbnailContainer.replaceChild(neww, oldw);
        } else {
            this.thumbnailContainer.appendChild(neww);
        }
        this.thumbnails[idx] = neww;
    }

    // ============== Image loading functions ==============
    setImgData(page, imgData) {
        this.images[page] = imgData;
    };

    async updateImgData(img, idx, callback, reload) {
        if (!img || !img.url) {
            console.error("Invalid image data:", img);
            return;
        }

        try {
            // imgData structure
            // {url: string // url of page contiang image
            //  width: number // image width, 
            //  height: number // image height, 
            //  path: string // path of image, 
            //  updated: boolean // is Data itself is updated
            //  nl: number // page url get when reload requested
            var imgData;
            if (reload) {
                imgData = await callback(img.nl, idx)
            } else {
                imgData = await callback(img.url, idx)
            }

            if (!imgData) {
                return;
            }
            
            // 이미지 경로 및 크기 정보 업데이트
            if (imgData.path) img.path = imgData.path;
            if (imgData.width) img.width = imgData.width;
            if (imgData.height) img.height = imgData.height;
            if (imgData.nl) img.nl = imgData.nl;
            img.updated = true;

            // check if thumbnails is empty
            const cls_list = this.thumbnails[idx]?.classList;
            if (!this.thumbnails[idx] || cls_list.contains('empty_thumb') || (reload && cls_list.contains("original_image")))  {
                var thumb_elem = this.iframe.contentDocument.createElement('img');
                thumb_elem.src = img.path;
                this.setThumbnail(idx, thumb_elem, "original_image", true);
            }

        } catch (error) {
            console.error("Error updating image:", error);
            throw error;  // 오류가 발생한 경우 상위로 throw하여 처리
        }
    };

    async updageImgsRange(start, end) {
        if (end < start) {
            console.error("Error in updateImgsAndCall: start is greater than end");
            return;
        }

        const update_entry = [];
        for (let idx = Math.max(start, 1); idx < Math.min(end, this.number_of_images + 1); idx++) {
            update_entry.push(idx - 1);
        }

        const promise_entry = update_entry.map(async (idx) => {
            const img = this.images[idx];
            if (img && img.updated) return;  // 이미 업데이트된 경우 skip
            await this.updateImgData(img, idx, this.extractImageData);
        });

        await Promise.all(promise_entry);
    };

    async reloadCurrentImg() {
        //console.log('reloadImg called');
        var n_curPanel = this.curPanel;

        // images[n_curPanel] = next page
        // if current page is last, entry current page only

        var update_entry;
        if (n_curPanel == this.number_of_images) {
            update_entry = [n_curPanel];
        } else {
            update_entry = [n_curPanel-1, n_curPanel];
        }

        const promise_entry = update_entry.map(async (idx) => {
            var iobj = this.images[idx];
            await this.reloadImg(iobj, idx);
        });
        await Promise.all(promise_entry);
        this.drawPanel();
    };

    async reloadImg(imgObj, idx) {
        await this.updateImgData(imgObj, idx, this.extractImageData, true)
    }

    preloader() {
        var len = this.iframe.contentDocument.getElementById('preloadInput').value;
        this.preloadImage(parseInt(len));
    }

    async preloadImage(length) {
        const preloadContainer = $('#preload', this.iframe_jq.contents());
        const currentPanel = this.curPanel;

        // 이미지 업데이트 호출 및 완료 후 처리
        await this.updageImgsRange(currentPanel - 2, currentPanel + length + 1);

        // 현재 preloadContainer 내의 img 요소 선택
        let imgElements = preloadContainer.find('img');

        // 필요한 이미지를 미리 로드하고 src만 업데이트
        for (let idx = 0; idx < length; idx++) {
            const panelIndex = currentPanel + idx;

            // 이미지가 존재하는 경우에만 로드
            if (panelIndex < this.number_of_images) {
                const imagePath = this.images[panelIndex].path;

                if (idx < imgElements.length) {
                    // 이미 img 요소가 있으면 src만 변경
                    $(imgElements[idx], this.iframe_jq.contents()).attr('src', imagePath);
                } else {
                    // 부족한 경우 새 img 요소를 추가
                    const newImage = $('<img />', { src: imagePath });
                    preloadContainer.append(newImage);
                    imgElements = preloadContainer.find('img'); // imgElements 업데이트
                }
            }
        }
        // 불필요한 추가 노드가 있으면 제거
        if (imgElements.length > length) {
            imgElements.slice(length).remove();
        }
    };

    // ============== Paging functions ==============
    goPanel() {
        const target = parseInt(prompt('target page'), 10);

        // target이 NaN이 아니고, 지정된 범위 내에 있을 때만 패널을 변경
        if (Number.isInteger(target) && target >= 0 && target <= this.number_of_images) {
            this.panelChange(target);
        }
    };

    pageChangedHalders = [];
    pageChanged() {
        // `prevPanel`과 `nextPanel`을 조건에 따라 enable/disable
        this.drawPanel();
        this.curPanel == 1 ? this.disable($('#prevPanel', this.iframe_jq.contents())) : this.enable($('#prevPanel', this.iframe_jq.contents()));
        this.curPanel == this.number_of_images ? this.disable($('#nextPanel', this.iframe_jq.contents())) : this.enable($('#nextPanel', this.iframe_jq.contents()));
        for (const handler of this.pageChangedHalders) {
            handler(this.curPanel);
        }
    };
    addPageChangedHandler(handler) {
        if (typeof handler === 'function') {
            this.pageChangedHalders.push(handler);
            return handler;
        }
    }
    removePageChangedHandler(to_remove) {
        if (!to_remove) return false;
        const initialLength = this.pageChangedHalders.length;
        this.pageChangedHalders = this.pageChangedHalders.filter(handler => handler !== to_remove);
        return this.pageChangedHalders.length < initialLength;
    }
    clearPageChangedHandlers() {
        this.pageChangedHalders = [];
    }

    toggleTimer () {
        var intervalSeconds = parseFloat(this.iframe.contentDocument.getElementById('pageTimer').value);
        if (intervalSeconds < 1 || isNaN(intervalSeconds)) {
            return;
        }

        this.timerflag = !this.timerflag;
        var pagerButton = this.iframe.contentDocument.getElementById('autoPager');

        if (this.timerflag) {
            pagerButton.style.color = 'white';
            this.timerInterval = setInterval(()=>this.nextPanel(), intervalSeconds * 1000);
        } else {
            pagerButton.style = '';
            clearInterval(this.timerInterval);
        }
    };

    selectorChanged() {
        var selector = $('#single-page-select', this.iframe_jq.contents());

        var selectedValue = selector.val();
        this.curPanel = Number(selectedValue);
        this.pageChanged();
        selector.trigger('blur');
    };

    panelChange(target) {
        if (target === this.curPanel) return; // Prevent unnecessary updates

        // Clear any pending image updates
        if (this._panelChangeTimeout) {
            clearTimeout(this._panelChangeTimeout);
        }

        this.curPanel = target;
        $('#single-page-select', this.iframe_jq.contents()).prop('selectedIndex', target - 1);

        // Use a small timeout to ensure UI updates first
        this._panelChangeTimeout = setTimeout(() => {
            this.pageChanged();
        }, 10);
    };

    prevPanel() {
        const currentPanel = this.curPanel;

        if (currentPanel <= 1) return;

        if (this.is_single_displayed) {
            this.panelChange(currentPanel - 1);
        } else {
            const prevImage = this.images[currentPanel - 2];
            const newPanel = (currentPanel > 2 && prevImage.width <= prevImage.height)
                            ? currentPanel - 2
                            : currentPanel - 1;
            this.panelChange(newPanel);
        }

        // Fix: Use the iframe's content document for scrolling
        $(this.iframe.contentDocument.body).scrollTop(0);
        this.comicImages.scrollTop = 0;
    };

    nextPanel() {
        const currentPanel = this.curPanel;

        if (currentPanel >= this.number_of_images) return;

        if (this.is_single_displayed) {
            this.panelChange(currentPanel + 1);
        } else {
            const nextImage = this.images[currentPanel]; // images is 0-based, and currentPanel is 1-based
            const newPanel = (currentPanel + 1 < this.number_of_images && nextImage.width <= nextImage.height)
                        ? currentPanel + 2
                        : currentPanel + 1;
            this.panelChange(newPanel);
        }

        // Fix: Use the iframe's content document for scrolling
        $(this.iframe.contentDocument.body).scrollTop(0);
        this.comicImages.scrollTop = 0;
    };

    // ============== Viewer options ==============

    renderOptions = [
        'render_auto',
        'render_crisp',
        'render_pixelated',
    ];

    renderChange(){
        var centerer = this.iframe.contentDocument.getElementById('centerer');
        this.renderType = (this.renderType + 1) % this.renderOptions.length;
        var render_class = this.renderOptions[this.renderType];

        this.removeClasses(centerer, this.renderOptions);
        centerer.classList.add(render_class);
    }

    fitOptions = {
        'stretchBoth': '<i class="bi bi-arrows-move"></i> Stretch Both',
        'stretchHorizontal': '<i class="bi bi-arrows"></i> Stretch Width',
        'stretchVertical': '<i class="bi bi-arrows-vertical"></i> Stretch Height',
        'fitBoth': '<i class="bi bi-plus-lg"></i> Fit Both',
        'fitHorizontal': '<i class="bi bi-dash-lg"></i> Fit Width',
        'fitVertical': '<span>┃</span> Fit Height',
    };

    changeFit() {
        this.fitType = (this.fitType + 1) % Object.keys(this.fitOptions).length;
        const classes = Object.keys(this.fitOptions);

        const centerer = this.iframe.contentDocument.getElementById('centerer');
        this.removeClasses(centerer, classes);
        centerer.classList.add(classes[this.fitType]);
        
        const fitChanger = this.iframe.contentDocument.getElementById('fitChanger');
        fitChanger.innerHTML = this.fitOptions[classes[this.fitType]];
    }

    toggleSpread() {
        this.setSpread(this.set_spread == 1 ? 2 : 1);
    }

    setSpread(num) {
        if (this.set_spread == num) return

        this.set_spread = num;
        const isSinglePage = this.set_spread === 1;

        $('#singlePage', this.iframe_jq.contents()).toggle(isSinglePage);
        $('#fullSpread', this.iframe_jq.contents()).toggle(!isSinglePage);
        this.drawPanel();
    }

    /**
     * Set spread's class "Without" changing spread mode; Used to inner logic to single page view on landscape picture
     * @param {Number} num - number to set spread class. 1 or 2
     * @returns 
     */
    setSpreadClass(num) {
        if (this.class_spread == num) return
        $('body', this.iframe_jq.contents()).removeClass('spread1 spread2');
        $('body', this.iframe_jq.contents()).addClass('spread' + num);
        this.class_spread = num;
    }

    //  ============== full screen functions ==============

    requestFullscreen() {
        if (document.fullscreenElement) return;
        var elem = this.comicImages;
        elem.requestFullscreen?.() || elem.msRequestFullscreen?.() || elem.mozRequestFullScreen?.() || elem.webkitRequestFullscreen?.();
    }

    exitFullscreen() {
        if (!document.fullscreenElement) return;
        document.exitFullscreen?.() || document.webkitExitFullscreen?.() || document.mozCancelFullScreen?.() || document.msExitFullscreen?.();
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            this.requestFullscreen()
        } else {
            this.exitFullscreen()
        }
    }

    handleFullscreenChange () {
        const toprt = this.iframe.contentDocument.getElementById('fullBtnTopRt');
        if (document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement) {
            // Fullscreen mode is active
            toprt.style.display = 'block';
            this.saveConfig('is_fullscreen', true);
        } else {
            // Fullscreen mode is inactive
            toprt.style.display = 'None';
            this.saveConfig('is_fullscreen', false);
        }
    }

    addFullscreenHandler(docu) {
        // Full screen handler
        docu.addEventListener('fullscreenchange', (() => this.handleFullscreenChange()));
        docu.addEventListener('webkitfullscreenchange', (() => this.handleFullscreenChange()));
        docu.addEventListener('mozfullscreenchange', (() => this.handleFullscreenChange()));
        docu.addEventListener('MSFullscreenChange', (() => this.handleFullscreenChange()));
    }

    // ============== Viewer functions ==============
    // functions called by user input

    openViewer() {
        var original_page = this.getPageFromOriginal ? this.getPageFromOriginal() : null;
        if (original_page) {
            this.panelChange(original_page);
        }
        this.iframe.style.display = 'block';
        this.iframe.focus();
        // to catch key events
        console.log("Viewer opened");
    }

    closeViewer() {
        this.iframe.style.display = 'none';
        this.exitFullscreen();
    };

    toggleViewer() {
        var is_visible = this.iframe.style.display === 'block';
        if (is_visible) {
            this.closeViewer();
        } else {
            this.openViewer();
        }
    };

    goGallery() {
        // by clicking galleryInfo, go to gallery page by brower, not iframe
        document.location = this.gallery_url;
    };

    imgDrag(e) {
        if (!this.dragState.isDragging) return;

        if (e.pageX > 0) {
            const deltaX = this.dragState.prevX - e.pageX;
            this.comicImages.scrollLeft += deltaX;
            this.dragState.prevX = e.pageX;
        }
        if (e.pageY > 0) {
            const deltaY = this.dragState.prevY - e.pageY;
            this.comicImages.scrollTop += deltaY;
            this.dragState.prevY = e.pageY;
        }
        e.preventDefault();
    };

    touchDrag(e) {
        if (!this.dragState.isDragging || e.touches.length !== 1) return; // multi touch

        const touch = e.touches[0];
        if (touch.pageX > 0) {
            const deltaX = this.dragState.prevX - touch.pageX;
            this.comicImages.scrollLeft += deltaX;
            this.dragState.prevX = touch.pageX;
        }
        if (touch.pageY > 0) {
            const deltaY = this.dragState.prevY - touch.pageY;
            this.comicImages.scrollTop += deltaY;
            this.dragState.prevY = touch.pageY;
        }
    }

    imgDragStart(e) {
        this.dragState.prevX = e.pageX;
        this.dragState.prevY = e.pageY;
        this.dragState.isDragging = true;
        e.preventDefault();
    };
    touchStart(e) {
        if (e.touches.length !== 1) return; 
        const touch = e.touches[0];
        this.dragState.prevX = touch.pageX;
        this.dragState.prevY = touch.pageY;
        this.dragState.isDragging = true;
        e.preventDefault();
    };

    imgDragEnd() {
        this.dragState.isDragging = false;
    };

    // wheel on bottom to next image
    doWheel(e) {
        e.preventDefault();
        const deltaY = e.deltaY || e.wheelDeltaY || e.detail || 0;
        
        // 이미지 컨테이너의 현재 스크롤 상태 확인
        const isAtTop = this.comicImages.scrollTop <= 0;
        const isAtBottom = this.comicImages.scrollTop + this.comicImages.clientHeight >= this.comicImages.scrollHeight - 1;
        
        // 위/아래 경계에 있고 해당 방향으로 더 스크롤하려는 경우
        if ((isAtTop && deltaY < 0) || (isAtBottom && deltaY > 0)) {
            // 즉시 페이지 전환 (스크롤 없이)
            deltaY > 0 ? this.nextPanel() : this.prevPanel();
            return;
        }
        
        // 그 외의 경우 정상 스크롤 처리
        this.comicImages.scrollTo({
            top: this.comicImages.scrollTop + deltaY,
            behavior: 'smooth'
        });
    };
    setGlobalHotkey(key, callback) {
        // Add global hotkey listener to root document
        document.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === key.toLowerCase()) {
                e.preventDefault(); // Prevent default behavior of the key
                callback(e); // Call the provided callback function
            }
        });
    };

    doHotkey(e) {
        switch (e.key.toLowerCase()) {
            case 'h':
            case 'a':
            case 'arrowleft':
                this.prevEpisode();
                break;
            case 'l':
            case 'd':
            case 'arrowright':
                this.nextEpisode();
                break;
            case 'j':
            case 'd':
            case 'arrowdown':
                this.nextPanel();
                break;
            case 'k':
            case 'w':
            case 'arrowup':
                this.prevPanel();
                break;
            case 'f':
                this.toggleSpread();
                break;
            case 'v':
                this.changeFit();
                break;
            case 'c':
                this.renderChange();
                break;
            case 'enter':
                this.toggleViewer();
                break;
            case ' ':
                this.toggleFullscreen();
                break;
            case 't':
                this.toggleTimer();
                break;
            case 'r':
                this.reloadCurrentImg();
                break;
            case 'p':
                this.preloader();
                break;
        }
    };

    // ==========  Update function ==========
    checkUpdate() {
        var github_api = "https://api.github.com";
        var repo_path = "/repos/skygarlics/exhviewer";
        // version_now
        var p_version = GM_info.script.version;
        this.simpleRequestAsync(github_api + repo_path + '/releases/latest')
        .then((response) => {
            resp_json = JSON.parse(response.responseText);
            var n_version = parseInt(resp_json["tag_name"]);
            var url = resp_json["assets"][0]["browser_download_url"];
            if ((p_version < n_version) && confirm("새 버전 : " + n_version + "\n업데이트 하시겠습니까?")) {
                alert("설치 후 새로고침하면 새 버전이 적용됩니다.");
                this.openInNewTab(url);
            }
        });
    }

    // ============== Utility functions ==============
    
    disable(elem) {
        elem.parent().addClass('disabled');
        elem.children().removeClass('icon_white');
    }

    enable(elem) {
        elem.parent().removeClass('disabled');
        elem.children().addClass('icon_white');
    }

    /**
     * 
     * @param {Element} elem - target element
     * @param {[string]} classes - List of strings to remove
     */
    removeClasses(elem, classes) {
        classes.forEach(cls => {
            elem.classList.remove(cls);
        });
    }

    /**
     * @param {Element} element - target element
     * @param {number} visibleRatio - visible ratio (0.0 ~ 1.0). Default is 0.5 (50%)
     * @param {Element} [rootElement=null] - root element for intersection observer (optional)
     * @returns {Promise<boolean>} - true if element is visible more than specific ratio, false otherwise
     */
    isElementVisible(element, visibleRatio = 0.5, rootElement = null) {
        return new Promise(resolve => {
            options = {
                root: rootElement,
                rootMargin: '0px',
                threshold: visibleRatio
            }
            const observer = new IntersectionObserver(entries => {
                resolve(entries[0].intersectionRatio >= visibleRatio);
                observer.disconnect();
            }, options);
            
            observer.observe(element);
        });
    }


    scrollToElem(scroll_elem, target_elem, option = { behavior: 'smooth', block: 'center' }) {
        if (scroll_elem == null || target_elem == null) return;
        // check if target_elem is descendant of scroll_elem
        if (!scroll_elem.contains(target_elem)) {
            console.warn(`Target element is not a descendant of scroll element: ${target_elem}`);
            return;
        }

        // Get the target element's position relative to the scroll container
        const targetTop = target_elem.offsetTop - scroll_elem.offsetTop;
        const targetHeight = target_elem.offsetHeight;
        const containerHeight = scroll_elem.clientHeight;

        let ttop = 0;
        // Calculate the scroll position based on the block option
        switch (option.block) {
            case 'start':
                ttop = targetTop; // Align the top of the target element with the top of the container
                break;
            case 'end':
                ttop = targetTop + targetHeight - containerHeight; // Align the bottom of the target element with the bottom of the container
                break;
            case 'nearest':
                const scrollTop = scroll_elem.scrollTop;
                const scrollBottom = scrollTop + containerHeight;
                const targetBottom = targetTop + targetHeight;

                if (targetBottom <= scrollBottom && targetTop >= scrollTop) {
                    // Already visible, no need to scroll
                    ttop = scrollTop;
                } else if (targetTop < scrollTop) {
                    // Scroll up to make the top of the target element visible
                    ttop = targetTop;
                } else {
                    // Scroll down to make the bottom of the target element visible
                    ttop = targetBottom - containerHeight;
                }
                break;
            case 'center':
            default:
                ttop = targetTop - (containerHeight - targetHeight) / 2; // Center the target element in the container
                break;
        }
        var tleft = target_elem.offsetLeft;
        // scroll_elem.scrollTop = ttop;
        // scroll_elem.scrollLeft = tleft;
        scroll_elem.scrollTo({
            top: ttop,
            left: tleft,
            behavior: option.behavior,
        });
        // 왜구현했냐이거대체
    }
    
    /**
     * Find the element closest to the target scroll position
     * @param {string} selector - CSS selector for the target elements.
     * @param {position} position - The target scroll position [top, mid, bottom] (default is center of the window).
     * @returns {HTMLElement|null} - The closest element to the target scroll position, or null if not found.
     * */
    findElementAtScroll(selector, position = 'mid') {
        if (!selector) return null;
    
        const elements = document.querySelectorAll(selector);
        if (elements.length === 0) return null;
        
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const windowHeight = window.innerHeight;

        let targetPoint;
        switch (position.toLowerCase()) {
            case 'top':
                targetPoint = scrollTop + (windowHeight * 0.25);
                break;
            case 'bottom':
                targetPoint = scrollTop + (windowHeight * 0.75);
                break;
            case 'mid':
            default:
                targetPoint = scrollTop + (windowHeight * 0.5);
                break;
        }

        let bestMatch = null;
        let minDistance = Infinity;
        
        Array.from(elements).forEach((element, index) => {
            const rect = element.getBoundingClientRect();
            
            // 요소의 위치 계산 (스크롤 위치 포함)
            const elementTop = rect.top + scrollTop;
            const elementBottom = rect.bottom + scrollTop;
            const elementHeight = rect.height;
            
            // 위치에 따라 요소의 참조점 결정
            let referencePoint;
            switch (position.toLowerCase()) {
                case 'top':
                    referencePoint = elementTop; // 요소의 상단
                    break;
                case 'bottom':
                    referencePoint = elementBottom; // 요소의 하단
                    break;
                case 'mid':
                default:
                    referencePoint = elementTop + (elementHeight / 2); // 요소의 중앙
                    break;
            }
            
            // 타겟 지점과의 거리 계산
            const distance = Math.abs(referencePoint - targetPoint);
            
            // 가장 가까운 요소 업데이트
            if (distance < minDistance) {
                minDistance = distance;
                bestMatch = { element, index };
            }
        });
        
        return bestMatch;
    }

    /**
     * Helper to make moveOriginalByViewer function; move to idx-th element by querySelectorAll(selector)
     * */
    makeMoveOriginalByViewer(selector) {
        return (idx) => {
            const elements = document.querySelectorAll(selector);
            if (elements.length > idx) {
                elements[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                console.warn(`Element at index ${idx} not found for selector "${selector}"`);
            }
        }
    }

    sleepSync(ms) {
        // can cause UI freeze
        var start = new Date().getTime();
        while (new Date().getTime() < start + ms) {
            // do nothing
        }
    }

    sleepAsync(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    openInNewTab(url) {
        var win = window.open(url, '_blank');
        win.focus();
    }

    // code from koreapyj/dcinside_lite
    xmlhttpRequest(details) {
        var bfloc = null;
        var xmlhttp = new XMLHttpRequest();

        if (details.withCredentials) {
            xmlhttp.withCredentials = true;
        }

        xmlhttp.ontimeout = function () {
            details.ontimeout();
        };
        xmlhttp.onreadystatechange = function () {
            var responseState = {
                responseXML: (xmlhttp.readyState === 4 ? xmlhttp.responseXML : ''),
                responseText: (xmlhttp.readyState === 4 ? xmlhttp.responseText : ''),
                readyState: xmlhttp.readyState,
                responseHeaders: (xmlhttp.readyState === 4 ? xmlhttp.getAllResponseHeaders()  : ''),
                status: (xmlhttp.readyState === 4 ? xmlhttp.status : 0),
                statusText: (xmlhttp.readyState === 4 ? xmlhttp.statusText : '')
            };
            if (details.onreadystatechange) {
                details.onreadystatechange(responseState);
            }
            if (xmlhttp.readyState === 4) {
                if (details.onload && xmlhttp.status >= 200 && xmlhttp.status < 300) {
                    details.onload(responseState);
                }
                if (details.onerror && (xmlhttp.status < 200 || xmlhttp.status >= 300)) {
                    details.onerror(responseState);
                }
            }
        };
        try {
            xmlhttp.open(details.method, details.url);
        } catch (e) {
            if (details.onerror) {
            details.onerror({
                responseXML: '',
                responseText: '',
                readyState: 4,
                responseHeaders: '',
                status: 403,
                statusText: 'Forbidden'
            });
            }
            return;
        }
        if (details.headers) {
            for (var prop in details.headers) {
                if (details.headers.hasOwnProperty(prop)) {
                    if (['origin',
                    'referer'].indexOf(prop.toLowerCase()) == - 1)
                    xmlhttp.setRequestHeader(prop, details.headers[prop]);
                    else {
                    bfloc = location.toString();
                    history.pushState(bfloc, '로드 중...', details.headers[prop]);
                    }
                }
            }
        }
        try {
            xmlhttp.send((typeof (details.data) !== 'undefined') ? details.data : null);
        }
        catch (e) {
            if (details.onerror) {
                details.onerror({
                    responseXML: '',
                    responseText: '',
                    readyState: 4,
                    responseHeaders: '',
                    status: 403,
                    statusText: 'Forbidden'
                });
            }
            return;
        }
        if (bfloc !== null)
            history.pushState(bfloc, bfloc, bfloc);
    };

    simpleRequestAsync(url, method = 'GET', headers = {}, data = null, withCredentials = true) {
        return new Promise((resolve, reject) => {
            var details = {
                method,
                url,
                timeout: 10000,
                withCredentials: withCredentials,
                ontimeout: (e) => reject(new Error("Request timed out")),
                onload: (response) => {
                    if (response.status >= 200 && response.status < 300) {
                        resolve(response)
                    } else {
                        reject(response)
                    }
                },
                onerror: (error) => reject(error)
            };
            // Add headers if any
            if (headers) {
                details.headers = headers;
                if (headers['content-type'] && headers['content-type'].match(/multipart\/form-data/i)) {
                    details.binary = true;
                }
            }
            // Set request data if provided
            if (data) details.data = data;
            this.xmlhttpRequest(details);
        });
    };

    parseHTML(response) {
        var doc = document.implementation.createHTMLDocument('temp');
        doc.documentElement.innerHTML = response.responseText;
        return doc;
    };

    // ============== style ==============
    viewer_style = `
    html {
        height: 100%;
        user-select: none;
    }
    body {
        background: #171717;
        font-size: 15px;
        font-weight: bold;
        background-color: #171717 !important;
        color: #999;
        height: 100%;
        display: flex;
        flex-direction: column;
    }
    h1 {
        color: #fff;
    }
    body .modal {
        color: #333;
    }
    .nav>li>a {
        padding: 15px 10px;
    }

    #comicImages {
        height: 100%;
        width: 100%;
        position: relative;
        overflow: auto;
        text-align: center;
        white-space: nowrap;
    }
        
    #centerer {
        display: inline-block;
        height: 100%;
        width: 100%;
        align-items: center;
        justify-content: center;
    }

    /* vanila state */
    img {
        display: inline-block;
    }

    /* stretchBoth */
    .stretchBoth img {
        display: inline-block;
        width: 100%;
        height: 100%;
        object-fit: contain;
    }

    /* stretchHorizontal */
    .stretchHorizontal img {
        display: inline-block;
        width: 100%;
        height: auto;
    }

    /* stretchVertical */
    .stretchVertical img {
        display: inline-block;
        width: auto;
        height: 100%;
    }
    
    /* fitBoth */
    .fitBoth img {
        display: inline-block;
        vertical-align: middle;
        max-width: 100%;
        max-height: 100%;
    }

    /* fitHorizontal styles */
    .fitHorizontal img {
        display: inline-block;
        vertical-align: middle;
        max-width: 100%;
    }
    .spread2 .fitHorizontal img {
        max-height: none;
        max-width: 50%;
    }

    /* fitVertical styles */
    .fitVertical img {
        display: inline-block;
        vertical-align: middle;
        max-height: 100%;
    }
    .spread2 .fitVertical img {
        max-width: none;
        max-height: 100%;
    }

    .spread2 #comicImages img.lt_img {
        object-position: right center;
    }
    .spread2 #comicImages img.rt_img {
        object-position: left center;
    }

    .spread2 #comicImages img{
        max-width: fit-content;
    }
    
    #preload {
        display: none;
    }
    .img-url {
        display: none;
    }
    a:hover {
        cursor: pointer;
        text-decoration: none;
    }
    a:visited,
    a:active {
        color: inherit;
    }
    .disabled > a:hover {
        background-color: transparent;
        background-image: none;
        color: #333333 !important;
        cursor: default;
        text-decoration: none;
    }
    .disabled > a {
        color: #333333 !important;
    }

    .icon_white {
        color: white;
    }
    .imageBtn,
    .imageBtn:hover {
        position: absolute;
        z-index: 1;
        width: 35%;
        height: 100%;
        font-size: 30px;
        color: rgba(255, 255, 255, 0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        text-decoration: none;
    }
    #leftBtn {
        margin-left: 25px;
        left: 0px;
    }
    #rightBtn {
        margin-right: 25px;
        right: 0px;
    }

    /* dropdown styles */
    #interfaceNav {
        margin: 0px;
        border: 0px;
    }
    .dropdown-menu {
        text-align: left;
    }
    .dropdown-menu span {
        text-align: center;
        display: inline-block;
        min-width: 18px;
    }
    .inverse-dropdown {
        background-color: #222 !important;
        border-color: #080808 !important;
    }
    .inverse-dropdown > li > a {
        color: #999999 !important;
    }
    .inverse-dropdown > li > a:hover {
        color: #fff !important;
        background-color: #000 !important;
    }

    #autoPager {
        display: inline;
    }
    #pageChanger {
        display: inline;
    }

    .input-medium {
        margin: 15px 15px 15px 3px;
        height: 20px;
        width: 58px;
    }
    #preloadInput {
        margin: 0px 10px;
        width: 3em;
        height: 1.8em;
    }

    #pageTimer {
        margin-left: 0.5rem;
        height: 2rem;
        width: 3rem;
    }
    #single-page-select {
        margin-left: 0.5rem;
        height: 2rem;
        width: 4rem;
    }

    #interfaceNav {
        padding: 0.2rem;
    }

    #funcs .nav-item:not(:first-child)  {
        padding-left: 0.5rem;
        margin-left: 0.5rem;
    }
    
    /* Render options */
    .render_auto img {
        image-rendering: auto;
    }

    .render_crisp img {
        image-rendering: -moz-crisp-edges; image-rendering: -webkit-optimize-contrast;
    }

    .render_pixelated img {
        image-rendering: pixelated;
    }

    .display_block {
        display: block !important;
    }
    .display_none {
        display: none !important;
    }

    .thumbnail_wrapper {
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 9em;
        width: min-content;
        height: min-content;
        background-color:rgba(60, 60, 60, 0.2);
        margin: 2px;
    }

    .thumbnail_wrapper > * {
        max-width: 100%;
        max-height: 100%;
    }

    #thumb_content {
        width: 100%;
        height: 100%;
    }

    /* fullscreen buttons */
    #fullBtnTopRt {
        display: none;
        position: fixed;
        top: 0;
        right: 10px;
        z-index: 1000;
        margin: 10px;
        font-size: 20px;
        color: rgba(255, 255, 255, 0.3);
    }`

    // ============== Dynamic styles ==============
    breakpoints = [
        { name: 'xs', width: 0 },
        { name: 'sm', width: 576 },
        { name: 'md', width: 768 },
        { name: 'lg', width: 992 },
        { name: 'xl', width: 1200 },
        { name: 'xxl', width: 1400 }
    ];

    d_style = `
    @media (max-width: {bp_width-1}px) {

    }
    @media (min-width: {bp_width}px) {
        .seperator-{bp_name}:not(:first-child)  {
            border-left: 1px solid #4b4b4b;
        }
    }`
    makeDynamicStyles() {
        var ret;
        this.breakpoints.forEach((bp) => {
            var style = this.d_style
                .replace(/{bp_name}/g, bp.name)
                .replace(/{bp_width}/g, bp.width)
                .replace(/{bp_width-1}/g, bp.width -1);
            ret += style;
        });
        return ret;
    }

    fullscreen_style = `
    .modal-backdrop:-webkit-full-screen,
    .modal-backdrop:-moz-full-screen,
    .modal-backdrop:-ms-fullscreen,
    .modal-backdrop:fullscreen {
        background-color: rgba(0, 0, 0, 0.5) !important;
        z-index: 1040 !important;
    }
    `

    // ============== HTML ==============
    navbarHTML = `
    <nav id="interfaceNav" class="navbar bg-dark navbar-expand-lg" data-bs-theme="dark" aria-label="Main navigation">
    <div class="container-fluid">
        <a class="navbar-brand" id="galleryInfo">Gallery</a>
        <button id="navbar-button" class="navbar-toggler" data-bs-toggle="collapse" data-bs-target="#collapseNavbar">
        <span class="navbar-toggler-icon"></span>
        </button>
        <div class="collapse navbar-collapse justify-content-center" id="collapseNavbar">
        <ul id="funcs" class="navbar-nav text-end">
            <li class="seperator-lg nav-item">
                <a class="nav-link" title="Left arrow or j" id="nextPanel">
                    <i class="bi bi-chevron-left"></i> Next
                </a>
            </li>
            <li class="seperator-lg nav-item">
                <a class="nav-link" title="Right arrow or k" id="prevPanel">
                    <i class="bi bi-chevron-right"></i> Prev
                </a>
            </li>
            <li class="seperator-lg nav-item">
                <div class="align-items-center">
                    <a id="autoPager" title="t">▶Auto</a>
                    <input id="pageTimer" class="form-control-sm" type="text" value="10">
                </div>
            </li>
            <li class="seperator-lg nav-item">
                <div class="align-items-center">
                    <a id="pageChanger">#</a>
                    <select class="form-select-sm" id="single-page-select"></select>
                </div>
            </li>
            <li class="seperator-lg nav-item">
                <a class="nav-link" id="thumbnailBtn" title="Show Thumbnails" data-bs-toggle="modal" data-bs-target="#thumbnailModal">
                    <i class="bi bi-grid"></i>
                </a>
            </li>
            <li class="seperator-lg nav-item">
                <a class="nav-link" id="fullscreener" title="Space">
                    <i class="bi bi-arrows-fullscreen"></i>
                </a>
            </li>
            <li class="seperator-lg nav-item dropdown">
                <a class="nav-link dropdown-toggle" href="#" id="navbarDropdownOptions" role="button" data-bs-toggle="dropdown" aria-expanded="false">
                    Options<span class="caret"></span>
                </a>
                <ul class="seperator-lg dropdown-menu dropdown-menu-dark aria-labelledby="navbarDropdownOptions">
                    <li>
                        <a class="dropdown-item" title="r" id="reload">
                            <span>&#10227;</span> Reload
                        </a>
                    </li>
                    <li>
                        <a class="dropdown-item fitBtn" title="b" id="fitChanger">
                            <i class="bi bi-arrows-move"></i> Change Fit
                        </a>
                    </li>
                    <li>
                        <a class="dropdown-item" title="f" id="fullSpread">
                            <i class="bi bi-book"></i> Full Spread
                        </a>
                    </li>
                    <li>
                        <a class="dropdown-item" title="s" id="singlePage">
                            <i class="bi bi-book-half"></i> Single Page
                        </a>
                    </li>
                    <li>
                        <a class="dropdown-item" title="rendering" id="renderingChanger">
                            <i class="bi bi-brush"></i> Rendering
                        </a>
                    </li>
                    <li>
                    <a class="dropdown-item" title="p" id="preloader">
                        Preload<input id="preloadInput" type="text" value="50">
                    </a>
                </ul>
            </li>
            <li class="seperator-lg nav-item">
                <a class="nav-link" title="Close viewer" id="viewerCloser">
                    <i class="bi bi-x-lg"></i>
                </a>
            </li>
        </ul>
        </div>
    </div>
    </nav>
    `

    thumbnailModalHTML = `
    <div id="thumbnailModal" class="modal fade" tabindex="-1" data-bs-theme="dark" aria-labelledby="thumbnailModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-xl modal-dialog-scrollable modal-fullscreen-lg-down">
            <div id="thumb_content" class="modal-content text-light">
                <div class="modal-header d-flex justify-content-between" style="padding:0rem 0.3rem;">
                    <div></div>
                    <div><h6 class="modal-title" id="thumbnailModalLabel">Thumbnails</h5></div>
                    <div><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close" style="margin:0"></button></div>  
                </div>
                <div id="thumb_container" class="modal-body d-flex flex-wrap justify-content-center align-items-center">
                </div>
                <!-- <div class="modal-footer"><button type="button" class="btn btn-primary" id="addthumb">Add thumb</button></div> -->
            </div>
        </div>
    </div>
    `

    imgFrameHTML = `
    <div id="comicImages" tabindex="1">
        <div id="fullBtnTopRt" class="flullscreenBtns">
                <a id="fullThumbnailBtn" title="Show Thumbnails" data-bs-toggle="modal" data-bs-target="#thumbnailModal"><i class="bi bi-grid"></i></a>
                <a id="fullscreen" title="Space"><i class="bi bi-arrows-fullscreen"></i></a>
        </div>
        <a id="leftBtn" class="imageBtn"></a>
        <a id="rightBtn" class="imageBtn"></a>
        <div id="centerer" class="d-flex"></div>
        ${this.thumbnailModalHTML}
    </div>
    <div id="preload"></div>
    `
}