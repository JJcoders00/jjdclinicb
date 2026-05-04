window.initCms = async function(db, getDoc, docRef) {
    const urlParams = new URLSearchParams(window.location.search);
    const isEditMode = urlParams.get('editMode') === 'true';

    // 1. Determine robust Page ID for saving to Firebase (Works on Local & GitHub Pages)
    const pathParts = window.location.pathname.toLowerCase().split('/').filter(p => p.length > 0);
    const lastPart = pathParts[pathParts.length - 1] || '';
    const folderPart = pathParts[pathParts.length - 2] || '';

    let pageId = 'homepage';
    if (folderPart === 'about' || lastPart === 'about.html') pageId = 'about';
    else if (folderPart === 'treatments' || lastPart === 'treatments.html') pageId = 'treatments';
    else if (folderPart === 'gallery' || lastPart === 'gallery.html') pageId = 'gallery';
    else if (folderPart === 'contact' || lastPart === 'contact.html') pageId = 'contact';
    else if (lastPart === 'index.html' || lastPart === '' || pathParts.length === 0) pageId = 'homepage';

    // 2. Identify all editable elements on the page
    const editableTags = 'h1, h2, h3, h4, h5, h6, p, span, li, a, label, button, div';
    let textCounter = 0;
    let imgCounter = 0;

    const editableEls = [];
    const imageEls = [];

    // Scan entire body
    document.querySelectorAll(editableTags).forEach(el => {
        // Exclude elements in Nav, Footer, or CMS tools, and specifically avoid icons
        if(el.closest('nav') || el.closest('footer') || el.closest('#mobile-menu-overlay') || el.closest('#cms-tools') || el.tagName.toLowerCase() === 'i' || el.classList.contains('fa-solid') || el.classList.contains('fa-brands')) return;
        
        // Target elements that directly contain text
        const hasDirectText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim().length > 0);
        
        if(hasDirectText) { 
            let id = el.getAttribute('data-cms-id');
            if(!id) {
                id = `auto-text-${textCounter++}`;
                el.setAttribute('data-cms-id', id);
            }
            editableEls.push(el);
        }
    });

    document.querySelectorAll('img').forEach(el => {
        if(el.closest('nav') || el.closest('footer') || el.closest('#cms-tools')) return;
        let id = el.getAttribute('data-cms-id');
        if(!id) {
            id = `auto-img-${imgCounter++}`;
            el.setAttribute('data-cms-id', id);
        }
        imageEls.push(el);
    });

    // 3. Fetch Existing CMS Content from Firebase
    try {
        const docSnap = await getDoc(docRef(db, "cms_content", pageId));
        if (docSnap.exists()) {
            const data = docSnap.data();
            editableEls.forEach(el => {
                const id = el.getAttribute('data-cms-id');
                if (data[id]) el.innerHTML = data[id];
                if (data[id + '_styles']) el.style.cssText += data[id + '_styles']; // Retain dragged sizes if any
            });
            imageEls.forEach(img => {
                const id = img.getAttribute('data-cms-id');
                if (data[id]) img.src = data[id];
                if (data[id + '_width']) img.style.width = data[id + '_width'];
                if (data[id + '_height']) img.style.height = data[id + '_height'];
            });
        }
    } catch(e) { console.error("CMS Load Error:", e); }

    // 4. Activate Visual Editor Mode
    if (isEditMode) {
        let currentMode = 'edit'; // 'edit' or 'nav'

        // --- Custom Animated Modal System ---
        function showCmsModal({ title, body, confirmText, onConfirm, isDanger = false }) {
            const overlay = document.createElement('div');
            overlay.id = 'cms-modal-overlay';
            overlay.className = 'fixed inset-0 z-[100000] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center opacity-0 transition-opacity duration-300';
            
            const modal = document.createElement('div');
            modal.className = 'bg-white rounded-[2rem] p-8 max-w-md w-full shadow-floating transform scale-95 transition-all duration-300 mx-4 border border-slate-100';
            
            const btnColor = isDanger ? 'bg-red-500 hover:bg-red-600' : 'bg-clinic-primary hover:bg-clinic-primaryHover';

            modal.innerHTML = `
                <h3 class="text-2xl font-extrabold text-slate-800 mb-4 tracking-tight">${title}</h3>
                <div class="text-slate-600 text-sm leading-relaxed">${body}</div>
                <div class="mt-8 flex justify-end gap-3">
                    <button id="cms-modal-cancel" class="px-5 py-2.5 rounded-full text-slate-500 font-bold hover:bg-slate-100 transition-colors">Cancel</button>
                    <button id="cms-modal-confirm" class="${btnColor} text-white px-6 py-2.5 rounded-full font-bold shadow-floating transition-transform active:scale-95 flex items-center gap-2">${confirmText}</button>
                </div>
            `;
            
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            
            requestAnimationFrame(() => {
                overlay.classList.remove('opacity-0');
                modal.classList.remove('scale-95');
            });

            const close = () => {
                overlay.classList.add('opacity-0');
                modal.classList.add('scale-95');
                setTimeout(() => overlay.remove(), 300);
            };

            modal.querySelector('#cms-modal-cancel').onclick = close;
            modal.querySelector('#cms-modal-confirm').onclick = () => {
                if(onConfirm) onConfirm();
                close();
            };
        }

        // --- Image Drag & Drop Resizing Tools ---
        let activeResizeImg = null;
        let startX, startY, startWidth, startHeight;

        const imgTools = document.createElement('div');
        imgTools.id = 'cms-img-tools';
        imgTools.className = 'fixed z-[10001] flex items-center gap-2 transition-opacity duration-200 pointer-events-auto opacity-0';
        imgTools.style.pointerEvents = 'none'; // Hidden initially
        
        const changeUrlBtn = document.createElement('button');
        changeUrlBtn.innerHTML = '<i class="fa-solid fa-link"></i>';
        changeUrlBtn.className = 'w-10 h-10 bg-slate-800 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-slate-700 transition-transform active:scale-90';
        changeUrlBtn.title = "Change Image URL";
        
        const dragHandle = document.createElement('div');
        dragHandle.innerHTML = '<i class="fa-solid fa-up-right-and-down-left-from-center text-[12px]"></i>';
        dragHandle.className = 'w-10 h-10 bg-clinic-primary text-white rounded-full shadow-floating flex items-center justify-center cursor-se-resize transition-transform active:scale-90';
        dragHandle.title = "Drag to Resize";

        imgTools.appendChild(changeUrlBtn);
        imgTools.appendChild(dragHandle);
        document.body.appendChild(imgTools);

        function updateToolsPos() {
            if(!activeResizeImg || currentMode !== 'edit') return;
            const rect = activeResizeImg.getBoundingClientRect();
            imgTools.style.top = (rect.top + 16) + 'px'; // Moved to top-left for better visibility
            imgTools.style.left = (rect.left + 16) + 'px';
        }

        window.addEventListener('scroll', updateToolsPos);
        window.addEventListener('resize', updateToolsPos);

        changeUrlBtn.addEventListener('click', () => {
            showCmsModal({
                title: 'Change Image',
                body: `
                    <p class="mb-4">Enter a new URL to replace this image visually.</p>
                    <input type="text" id="cms-img-url" class="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-clinic-primary text-slate-800 font-medium" value="${activeResizeImg.src}" placeholder="https://...">
                `,
                confirmText: '<i class="fa-solid fa-check"></i> Apply',
                onConfirm: () => {
                    const newUrl = document.getElementById('cms-img-url').value.trim();
                    if(newUrl) activeResizeImg.src = newUrl;
                    updateToolsPos();
                }
            });
        });

        const initResize = (e) => {
            e.preventDefault();
            startX = e.clientX || (e.touches && e.touches[0].clientX);
            startY = e.clientY || (e.touches && e.touches[0].clientY);
            const rect = activeResizeImg.getBoundingClientRect();
            startWidth = rect.width;
            startHeight = rect.height;
            document.addEventListener('mousemove', doResize);
            document.addEventListener('mouseup', stopResize);
            document.addEventListener('touchmove', doResize, {passive: false});
            document.addEventListener('touchend', stopResize);
        };

        const doResize = (e) => {
            const clientX = e.clientX || (e.touches && e.touches[0].clientX);
            const width = startWidth + (clientX - startX);
            activeResizeImg.style.width = width + 'px';
            activeResizeImg.style.height = 'auto'; // Maintain aspect ratio
            updateToolsPos();
        };

        const stopResize = () => {
            document.removeEventListener('mousemove', doResize);
            document.removeEventListener('mouseup', stopResize);
            document.removeEventListener('touchmove', doResize);
            document.removeEventListener('touchend', stopResize);
        };

        dragHandle.addEventListener('mousedown', initResize);
        dragHandle.addEventListener('touchstart', initResize, {passive: false});

        // Intercept links so edit mode persists across page navigation
        document.querySelectorAll('a').forEach(a => {
            a.addEventListener('click', (e) => {
                // Ignore # links
                const hrefAttr = a.getAttribute('href');
                if(hrefAttr && hrefAttr.startsWith('#')) return;
                
                if (currentMode === 'edit') {
                    // Prevent navigation, allow editing!
                    e.preventDefault();
                    return; 
                } else {
                    // Navigate Mode!
                    e.preventDefault();
                    if(a.href && !a.href.startsWith('javascript')) {
                        try {
                            let url = new URL(a.href);
                            url.searchParams.set('editMode', 'true');
                            window.location.href = url.href;
                        } catch(err) {
                            let href = a.href;
                            if(href.includes('?')) href += '&editMode=true';
                            else href += '?editMode=true';
                            window.location.href = href;
                        }
                    }
                }
            });
        });

        // Setup Floating Styling Toolbar
        const toolsContainer = document.createElement('div');
        toolsContainer.id = 'cms-tools';
        
        const toolbar = document.createElement('div');
        toolbar.className = 'fixed top-4 left-1/2 -translate-x-1/2 z-[9999] bg-white border border-slate-200 shadow-floating rounded-full px-4 py-2 flex items-center gap-2 transition-all duration-300 scale-95 origin-top';
        toolbar.style.opacity = '0';
        toolbar.style.pointerEvents = 'none';
        
        const createBtn = (icon, cmd, val = null, title = '') => {
            const btn = document.createElement('button');
            btn.innerHTML = icon;
            btn.title = title;
            btn.className = 'w-8 h-8 rounded hover:bg-slate-100 font-bold text-slate-700 flex items-center justify-center transition-colors';
            btn.onmousedown = (e) => {
                e.preventDefault(); // Keep focus on text
                document.execCommand(cmd, false, val);
            };
            return btn;
        };

        toolbar.appendChild(createBtn('<i class="fa-solid fa-rotate-left"></i>', 'undo', null, 'Undo'));
        toolbar.appendChild(createBtn('<i class="fa-solid fa-rotate-right"></i>', 'redo', null, 'Redo'));
        
        const divider1 = document.createElement('div');
        divider1.className = 'w-px h-6 bg-slate-200 mx-1';
        toolbar.appendChild(divider1);
        
        toolbar.appendChild(createBtn('B', 'bold', null, 'Bold'));
        toolbar.appendChild(createBtn('<i style="font-family:serif">I</i>', 'italic', null, 'Italic'));
        toolbar.appendChild(createBtn('<u>U</u>', 'underline', null, 'Underline'));
        
        const divider2 = document.createElement('div');
        divider2.className = 'w-px h-6 bg-slate-200 mx-1';
        toolbar.appendChild(divider2);
        
        toolbar.appendChild(createBtn('<i class="fa-solid fa-align-left"></i>', 'justifyLeft', null, 'Align Left'));
        toolbar.appendChild(createBtn('<i class="fa-solid fa-align-center"></i>', 'justifyCenter', null, 'Align Center'));
        toolbar.appendChild(createBtn('<i class="fa-solid fa-align-right"></i>', 'justifyRight', null, 'Align Right'));

        const divider3 = document.createElement('div');
        divider3.className = 'w-px h-6 bg-slate-200 mx-1';
        toolbar.appendChild(divider3);
        
        const colorPicker = document.createElement('input');
        colorPicker.type = 'color';
        colorPicker.className = 'w-8 h-8 cursor-pointer rounded-full overflow-hidden border-0 p-0';
        colorPicker.title = 'Text Color';
        colorPicker.onchange = (e) => document.execCommand('foreColor', false, e.target.value);
        toolbar.appendChild(colorPicker);

        const highlightPicker = document.createElement('input');
        highlightPicker.type = 'color';
        highlightPicker.value = '#ffff00';
        highlightPicker.className = 'w-8 h-8 cursor-pointer rounded-full overflow-hidden border-0 p-0';
        highlightPicker.title = 'Highlight Color';
        highlightPicker.onchange = (e) => document.execCommand('hiliteColor', false, e.target.value);
        toolbar.appendChild(highlightPicker);
        
        toolbar.appendChild(createBtn('<i class="fa-solid fa-eraser text-red-500 text-sm"></i>', 'removeFormat', null, 'Clear Formatting'));
        toolsContainer.appendChild(toolbar);

        // Function to bind Editable logic
        function bindEditableLogic() {
            editableEls.forEach(el => {
                el.setAttribute('contenteditable', 'true');
                el.classList.add('outline-none', 'transition-all', 'duration-200');
                el.style.border = '1px dashed rgba(13, 148, 136, 0.4)';
                el.style.minHeight = '1em';
                
                el.addEventListener('focus', () => {
                    if(currentMode !== 'edit') return;
                    el.style.backgroundColor = 'rgba(13, 148, 136, 0.05)';
                    el.style.border = '1px dashed rgba(13, 148, 136, 1)';
                    toolbar.style.opacity = '1';
                    toolbar.style.transform = 'translate(-50%, 0) scale(1)';
                    toolbar.style.pointerEvents = 'auto';
                });
                el.addEventListener('blur', () => {
                    if(currentMode !== 'edit') return;
                    el.style.backgroundColor = 'transparent';
                    el.style.border = '1px dashed rgba(13, 148, 136, 0.4)';
                    setTimeout(() => {
                        if(document.activeElement.getAttribute('contenteditable') !== 'true') {
                            toolbar.style.opacity = '0';
                            toolbar.style.transform = 'translate(-50%, -10px) scale(0.95)';
                            toolbar.style.pointerEvents = 'none';
                        }
                    }, 200);
                });
            });

            imageEls.forEach(img => {
                img.style.outline = '3px dashed #0D9488';
                img.style.outlineOffset = '-3px';
                
                // Double click to instantly open change URL modal
                img.addEventListener('dblclick', (e) => {
                    if(currentMode !== 'edit') return;
                    e.preventDefault();
                    activeResizeImg = img;
                    changeUrlBtn.click();
                });

                img.addEventListener('click', (e) => {
                    if(currentMode !== 'edit') return;
                    e.preventDefault();
                    activeResizeImg = img;
                    imgTools.style.opacity = '1';
                    imgTools.style.pointerEvents = 'auto';
                    updateToolsPos();
                });
            });
            
            document.addEventListener('click', (e) => {
                if(currentMode !== 'edit') return;
                // Don't close if clicking modal, img tools, tools container, or an image
                if(!e.target.closest('img') && !e.target.closest('#cms-tools') && !e.target.closest('#cms-img-tools') && !e.target.closest('#cms-modal-overlay')) {
                    imgTools.style.opacity = '0';
                    imgTools.style.pointerEvents = 'none';
                    activeResizeImg = null;
                }
            });
        }
        
        bindEditableLogic(); // init

        // Save, Reset, & Mode Buttons
        const controls = document.createElement('div');
        controls.className = 'fixed bottom-5 right-5 z-[9999] flex flex-col sm:flex-row gap-3 items-end sm:items-center';
        
        const modeBtn = document.createElement('button');
        modeBtn.innerHTML = '<i class="fa-solid fa-pen-nib"></i> Mode: Editor';
        modeBtn.className = 'bg-slate-800 text-white px-5 py-3 rounded-full shadow-floating font-bold flex items-center gap-2 hover:bg-slate-700 transition-all cursor-pointer text-sm';
        
        modeBtn.onclick = () => {
            if(currentMode === 'edit') {
                currentMode = 'nav';
                modeBtn.innerHTML = '<i class="fa-solid fa-hand-pointer"></i> Mode: Navigating';
                modeBtn.classList.replace('bg-slate-800', 'bg-purple-600');
                modeBtn.classList.replace('hover:bg-slate-700', 'hover:bg-purple-700');
                
                // Disable editing styling
                editableEls.forEach(el => {
                    el.setAttribute('contenteditable', 'false');
                    el.style.border = 'none';
                    el.style.backgroundColor = 'transparent';
                });
                imageEls.forEach(img => img.style.outline = 'none');
                imgTools.style.opacity = '0';
                imgTools.style.pointerEvents = 'none';
                toolbar.style.opacity = '0';
                toolbar.style.pointerEvents = 'none';
                activeResizeImg = null;
                
            } else {
                currentMode = 'edit';
                modeBtn.innerHTML = '<i class="fa-solid fa-pen-nib"></i> Mode: Editor';
                modeBtn.classList.replace('bg-purple-600', 'bg-slate-800');
                modeBtn.classList.replace('hover:bg-purple-700', 'hover:bg-slate-700');
                
                // Enable editing styling
                editableEls.forEach(el => {
                    el.setAttribute('contenteditable', 'true');
                    el.style.border = '1px dashed rgba(13, 148, 136, 0.4)';
                });
                imageEls.forEach(img => img.style.outline = '3px dashed #0D9488');
            }
        };

        const resetBtn = document.createElement('button');
        resetBtn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Revert';
        resetBtn.className = 'bg-white text-slate-700 border border-slate-200 px-5 py-3 rounded-full shadow-sm font-bold flex items-center gap-2 hover:bg-slate-50 transition-all cursor-pointer text-sm';

        const saveBtn = document.createElement('button');
        saveBtn.innerHTML = '<i class="fa-solid fa-save"></i> Publish';
        saveBtn.className = 'bg-clinic-primary text-white px-8 py-3 rounded-full shadow-floating font-bold flex items-center gap-2 hover:bg-clinic-primaryHover transition-transform active:scale-95 cursor-pointer text-sm';
        
        controls.appendChild(modeBtn);
        controls.appendChild(resetBtn);
        controls.appendChild(saveBtn);
        toolsContainer.appendChild(controls);
        
        document.body.appendChild(toolsContainer);

        saveBtn.addEventListener('click', () => {
            showCmsModal({
                title: 'Publish Changes',
                body: '<p>Are you sure you want to publish these changes? They will be immediately visible on your live website.</p>',
                confirmText: '<i class="fa-solid fa-cloud-arrow-up"></i> Publish Now',
                onConfirm: () => {
                    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
                    saveBtn.disabled = true;
                    
                    const updates = {};
                    editableEls.forEach(el => updates[el.getAttribute('data-cms-id')] = el.innerHTML);
                    imageEls.forEach(img => {
                        updates[img.getAttribute('data-cms-id')] = img.src;
                        updates[img.getAttribute('data-cms-id') + '_width'] = img.style.width;
                        updates[img.getAttribute('data-cms-id') + '_height'] = img.style.height;
                    });
                    
                    window.parent.postMessage({ type: 'SAVE_CMS', pageId: pageId, payload: updates }, '*');
                }
            });
        });

        resetBtn.addEventListener('click', () => {
            showCmsModal({
                title: 'Revert to Original',
                body: '<p class="text-red-500 font-medium"><i class="fa-solid fa-triangle-exclamation"></i> Warning: This will permanently delete all your custom edits on this page.</p><p class="mt-2">Are you sure you want to restore the hardcoded developer design?</p>',
                confirmText: '<i class="fa-solid fa-trash-can"></i> Revert Page',
                isDanger: true,
                onConfirm: () => {
                    window.parent.postMessage({ type: 'RESET_CMS', pageId: pageId }, '*');
                }
            });
        });

        window.addEventListener('message', (event) => {
            if (event.data.type === 'CMS_SAVE_SUCCESS') {
                saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> Published!';
                saveBtn.classList.replace('bg-clinic-primary', 'bg-green-500');
                setTimeout(() => {
                    saveBtn.innerHTML = '<i class="fa-solid fa-save"></i> Publish';
                    saveBtn.classList.replace('bg-green-500', 'bg-clinic-primary');
                    saveBtn.disabled = false;
                }, 2000);
            } else if (event.data.type === 'CMS_SAVE_ERROR') {
                saveBtn.innerHTML = 'Error Saving';
                saveBtn.classList.replace('bg-clinic-primary', 'bg-red-500');
                saveBtn.disabled = false;
            }
        });
    }
}
