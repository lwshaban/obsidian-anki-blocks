/**
 * HTML ↔ Markdown Converter
 *
 * Converts between HTML (used by Anki) and Markdown (used by Obsidian).
 * Handles common formatting elements while preserving content integrity.
 */

// ============================================================================
// Markdown → HTML Conversion
// ============================================================================

/**
 * Convert Markdown text to HTML for Anki
 */
export function markdownToHtml(markdown: string): string {
    if (!markdown) return '';

    let html = markdown;

    // Preserve Anki cloze deletions by replacing them with placeholders
    // Pattern matches {{cN::content}} and {{cN::content::hint}}
    // Using ZZZCLOZE format to avoid conflicts with markdown syntax (* and _)
    const clozePattern = /\{\{c\d+::[\s\S]*?\}\}/g;
    const clozePlaceholders: string[] = [];
    html = html.replace(clozePattern, (match) => {
        const placeholder = `ZZZCLOZE${clozePlaceholders.length}ZZZ`;
        clozePlaceholders.push(match);
        return placeholder;
    });

    // Preserve images and links BEFORE formatting to protect URLs with underscores
    const imageLinkPlaceholders: string[] = [];

    // Images - ![alt](src) and ![alt|size](src)
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match) => {
        const placeholder = `ZZZIMG${imageLinkPlaceholders.length}ZZZ`;
        imageLinkPlaceholders.push(match);
        return placeholder;
    });

    // Obsidian image embeds - ![[filename]]
    html = html.replace(/!\[\[([^\]]+)\]\]/g, (match) => {
        const placeholder = `ZZZIMG${imageLinkPlaceholders.length}ZZZ`;
        imageLinkPlaceholders.push(match);
        return placeholder;
    });

    // Links - [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match) => {
        const placeholder = `ZZZLINK${imageLinkPlaceholders.length}ZZZ`;
        imageLinkPlaceholders.push(match);
        return placeholder;
    });

    // Obsidian wikilinks - [[link|display]] or [[link]]
    html = html.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (match) => {
        const placeholder = `ZZZLINK${imageLinkPlaceholders.length}ZZZ`;
        imageLinkPlaceholders.push(match);
        return placeholder;
    });
    html = html.replace(/\[\[([^\]]+)\]\]/g, (match) => {
        const placeholder = `ZZZLINK${imageLinkPlaceholders.length}ZZZ`;
        imageLinkPlaceholders.push(match);
        return placeholder;
    });

    // Escape HTML entities first (but not in code blocks)
    html = escapeHtmlOutsideCode(html);

    // Code blocks (fenced) - must be processed before inline code
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        const unescapedCode = unescapeHtml(code.trim());
        return `<pre><code class="language-${lang || 'plaintext'}">${escapeHtml(unescapedCode)}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, (_, code) => {
        const unescapedCode = unescapeHtml(code);
        return `<code>${escapeHtml(unescapedCode)}</code>`;
    });

    // Headers (process from h6 to h1 to avoid conflicts)
    html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

    // Bold and italic combinations
    html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');

    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/_([^_\s][^_]*)_/g, '<em>$1</em>');

    // Strikethrough
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // Highlight (Obsidian syntax)
    html = html.replace(/==([^=]+)==/g, '<mark>$1</mark>');

    // Horizontal rule
    html = html.replace(/^(-{3,}|\*{3,}|_{3,})$/gm, '<hr>');

    // Blockquotes (simple single-level)
    html = html.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');
    // Merge consecutive blockquotes
    html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

    // Unordered lists
    html = convertLists(html);

    // Line breaks - double newline becomes paragraph, single becomes <br>
    html = convertParagraphs(html);

    // Restore images and links, converting to HTML
    for (let i = 0; i < imageLinkPlaceholders.length; i++) {
        const original = imageLinkPlaceholders[i]!;
        let converted: string;

        // Check what type of placeholder and convert accordingly
        if (html.includes(`ZZZIMG${i}ZZZ`)) {
            // Image: ![alt](src), ![alt|width](src), or ![[file]]
            const mdImageMatch = original.match(/!\[([^\]]*)\]\(([^)]+)\)/);
            const obsidianImageMatch = original.match(/!\[\[([^\]]+)\]\]/);

            if (mdImageMatch) {
                const altText = mdImageMatch[1] ?? '';
                const src = mdImageMatch[2];

                // Check for Obsidian width syntax: alt|width or alt|widthxheight
                const altWidthMatch = altText.match(/^(.*)?\|(\d+)(?:x(\d+))?$/);

                if (altWidthMatch) {
                    const alt = altWidthMatch[1] ?? '';
                    const width = altWidthMatch[2];
                    const height = altWidthMatch[3];
                    if (height) {
                        converted = `<img src="${src}" alt="${alt}" width="${width}" height="${height}">`;
                    } else {
                        converted = `<img src="${src}" alt="${alt}" width="${width}">`;
                    }
                } else {
                    converted = `<img src="${src}" alt="${altText}">`;
                }
            } else if (obsidianImageMatch) {
                const content = obsidianImageMatch[1] ?? '';
                // Check for width syntax: ![[file|width]] or ![[file|widthxheight]]
                const fileWidthMatch = content.match(/^(.+?)\|(\d+)(?:x(\d+))?$/);

                if (fileWidthMatch) {
                    const file = fileWidthMatch[1];
                    const width = fileWidthMatch[2];
                    const height = fileWidthMatch[3];
                    if (height) {
                        converted = `<img src="${file}" alt="${file}" width="${width}" height="${height}">`;
                    } else {
                        converted = `<img src="${file}" alt="${file}" width="${width}">`;
                    }
                } else {
                    converted = `<img src="${content}" alt="${content}">`;
                }
            } else {
                converted = original;
            }
            html = html.replace(`ZZZIMG${i}ZZZ`, converted);
        } else if (html.includes(`ZZZLINK${i}ZZZ`)) {
            // Link: [text](url) or [[link]] or [[link|display]]
            const mdLinkMatch = original.match(/\[([^\]]+)\]\(([^)]+)\)/);
            const wikiLinkDisplayMatch = original.match(/\[\[([^\]|]+)\|([^\]]+)\]\]/);
            const wikiLinkMatch = original.match(/\[\[([^\]]+)\]\]/);

            if (mdLinkMatch) {
                converted = `<a href="${mdLinkMatch[2]}">${mdLinkMatch[1]}</a>`;
            } else if (wikiLinkDisplayMatch) {
                converted = `<a href="${wikiLinkDisplayMatch[1]}">${wikiLinkDisplayMatch[2]}</a>`;
            } else if (wikiLinkMatch) {
                converted = `<a href="${wikiLinkMatch[1]}">${wikiLinkMatch[1]}</a>`;
            } else {
                converted = original;
            }
            html = html.replace(`ZZZLINK${i}ZZZ`, converted);
        }
    }

    // Restore Anki cloze deletions
    for (let i = 0; i < clozePlaceholders.length; i++) {
        html = html.replace(`ZZZCLOZE${i}ZZZ`, clozePlaceholders[i]!);
    }

    return html.trim();
}

/**
 * Escape HTML entities outside of code blocks
 */
function escapeHtmlOutsideCode(text: string): string {
    // Split by code blocks, escape non-code parts
    const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g);
    return parts.map((part, index) => {
        // Odd indices are code blocks (from the capturing group)
        if (index % 2 === 1) return part;
        return escapeHtml(part);
    }).join('');
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Unescape HTML entities
 */
function unescapeHtml(text: string): string {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');
}

/**
 * Convert markdown lists to HTML
 */
function convertLists(html: string): string {
    const lines = html.split('\n');
    const result: string[] = [];
    let inUnorderedList = false;
    let inOrderedList = false;

    for (const line of lines) {
        const unorderedMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
        const orderedMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);

        if (unorderedMatch) {
            if (!inUnorderedList) {
                if (inOrderedList) {
                    result.push('</ol>');
                    inOrderedList = false;
                }
                result.push('<ul>');
                inUnorderedList = true;
            }
            result.push(`<li>${unorderedMatch[2]}</li>`);
        } else if (orderedMatch) {
            if (!inOrderedList) {
                if (inUnorderedList) {
                    result.push('</ul>');
                    inUnorderedList = false;
                }
                result.push('<ol>');
                inOrderedList = true;
            }
            result.push(`<li>${orderedMatch[2]}</li>`);
        } else {
            if (inUnorderedList) {
                result.push('</ul>');
                inUnorderedList = false;
            }
            if (inOrderedList) {
                result.push('</ol>');
                inOrderedList = false;
            }
            result.push(line);
        }
    }

    // Close any open lists
    if (inUnorderedList) result.push('</ul>');
    if (inOrderedList) result.push('</ol>');

    return result.join('\n');
}

/**
 * Convert line breaks to paragraphs and <br> tags
 */
function convertParagraphs(html: string): string {
    // Don't wrap block elements in paragraphs
    const blockElements = ['<h1>', '<h2>', '<h3>', '<h4>', '<h5>', '<h6>',
                          '<ul>', '<ol>', '<li>', '<blockquote>', '<pre>',
                          '<hr>', '</ul>', '</ol>', '</li>', '</blockquote>', '</pre>',
                          '</h1>', '</h2>', '</h3>', '</h4>', '</h5>', '</h6>'];

    const paragraphs = html.split(/\n\n+/);

    return paragraphs.map(p => {
        const trimmed = p.trim();
        if (!trimmed) return '';

        // Check if this is a block element
        const isBlock = blockElements.some(tag => trimmed.startsWith(tag) || trimmed.includes(tag));
        if (isBlock) {
            // Replace single newlines with <br> inside non-block content
            return trimmed.replace(/\n/g, '<br>');
        }

        // Wrap in paragraph and convert single newlines to <br>
        return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
    }).filter(p => p).join('\n');
}


// ============================================================================
// HTML → Markdown Conversion
// ============================================================================

/**
 * Convert HTML text to Markdown for Obsidian
 */
export function htmlToMarkdown(html: string): string {
    if (!html) return '';

    let md = html;

    // Normalize whitespace but preserve intentional line breaks
    md = md.replace(/\r\n/g, '\n');

    // Pre/Code blocks first (to protect their content)
    md = md.replace(/<pre><code(?:\s+class="language-(\w+)")?>([\s\S]*?)<\/code><\/pre>/gi,
        (_, lang, code) => `\`\`\`${lang || ''}\n${unescapeHtml(code.trim())}\n\`\`\``);

    // Inline code
    md = md.replace(/<code>([^<]*)<\/code>/gi, (_, code) => `\`${unescapeHtml(code)}\``);

    // Headers
    md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1');
    md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1');
    md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1');
    md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1');
    md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '##### $1');
    md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '###### $1');

    // Bold and italic
    md = md.replace(/<strong><em>([\s\S]*?)<\/em><\/strong>/gi, '***$1***');
    md = md.replace(/<em><strong>([\s\S]*?)<\/strong><\/em>/gi, '***$1***');
    md = md.replace(/<b><i>([\s\S]*?)<\/i><\/b>/gi, '***$1***');
    md = md.replace(/<i><b>([\s\S]*?)<\/b><\/i>/gi, '***$1***');
    md = md.replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**');
    md = md.replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**');
    md = md.replace(/<em>([\s\S]*?)<\/em>/gi, '*$1*');
    md = md.replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*');

    // Strikethrough
    md = md.replace(/<del>([\s\S]*?)<\/del>/gi, '~~$1~~');
    md = md.replace(/<s>([\s\S]*?)<\/s>/gi, '~~$1~~');
    md = md.replace(/<strike>([\s\S]*?)<\/strike>/gi, '~~$1~~');

    // Highlight/Mark
    md = md.replace(/<mark>([\s\S]*?)<\/mark>/gi, '==$1==');

    // Images
    md = md.replace(/<img[^>]+src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)');
    md = md.replace(/<img[^>]+alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/gi, '![$1]($2)');
    md = md.replace(/<img[^>]+src="([^"]*)"[^>]*\/?>/gi, '![]($1)');

    // Links
    md = md.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

    // Blockquotes
    md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
        return content.split('\n').map((line: string) => `> ${line.trim()}`).join('\n');
    });

    // Lists
    md = convertHtmlListsToMarkdown(md);

    // Horizontal rule
    md = md.replace(/<hr\s*\/?>/gi, '\n---\n');

    // Paragraphs and line breaks
    md = md.replace(/<br\s*\/?>/gi, '\n');
    md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');

    // Divs (treat as block elements)
    md = md.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, '$1\n');

    // Spans (just extract content)
    md = md.replace(/<span[^>]*>([\s\S]*?)<\/span>/gi, '$1');

    // Remove any remaining HTML tags
    md = md.replace(/<[^>]+>/g, '');

    // Unescape HTML entities
    md = unescapeHtml(md);

    // Clean up excessive whitespace
    md = md.replace(/\n{3,}/g, '\n\n');
    md = md.trim();

    return md;
}

/**
 * Convert HTML lists to Markdown
 */
function convertHtmlListsToMarkdown(html: string): string {
    let md = html;

    // Process unordered lists
    md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, content) => {
        return convertListItems(content, '-');
    });

    // Process ordered lists
    md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, content) => {
        return convertListItems(content, '1.');
    });

    return md;
}

/**
 * Convert list items to markdown format
 */
function convertListItems(content: string, marker: string): string {
    const items: string[] = [];
    const itemRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let match;
    let counter = 1;

    while ((match = itemRegex.exec(content)) !== null) {
        const itemContent = (match[1] ?? '').trim();
        const actualMarker = marker === '1.' ? `${counter}.` : marker;
        items.push(`${actualMarker} ${itemContent}`);
        counter++;
    }

    return items.join('\n') + '\n';
}


// ============================================================================
// Field Conversion Utilities
// ============================================================================

/**
 * Convert all fields in a card from Markdown to HTML
 */
export function convertFieldsToHtml(fields: Record<string, string>): Record<string, string> {
    const converted: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
        converted[key] = markdownToHtml(value);
    }
    return converted;
}

/**
 * Convert all fields in a card from HTML to Markdown
 */
export function convertFieldsToMarkdown(fields: Record<string, string>): Record<string, string> {
    const converted: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
        converted[key] = htmlToMarkdown(value);
    }
    return converted;
}

/**
 * Detect if content is likely HTML (has HTML tags)
 */
export function isHtml(content: string): boolean {
    // Check for common HTML tags
    const htmlTagPattern = /<\/?(?:p|div|span|br|h[1-6]|ul|ol|li|a|img|strong|em|b|i|code|pre|blockquote)[^>]*>/i;
    return htmlTagPattern.test(content);
}

/**
 * Smart convert: detects format and converts if needed
 * @param content - The content to convert
 * @param targetFormat - 'html' or 'markdown'
 */
export function smartConvert(content: string, targetFormat: 'html' | 'markdown'): string {
    if (!content) return '';

    const contentIsHtml = isHtml(content);

    if (targetFormat === 'html') {
        return contentIsHtml ? content : markdownToHtml(content);
    } else {
        return contentIsHtml ? htmlToMarkdown(content) : content;
    }
}

/**
 * Smart convert all fields
 */
export function smartConvertFields(
    fields: Record<string, string>,
    targetFormat: 'html' | 'markdown'
): Record<string, string> {
    const converted: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
        converted[key] = smartConvert(value, targetFormat);
    }
    return converted;
}
