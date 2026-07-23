/* define constants */
const THEME_SYSTEM = 'system';
const THEME_LIGHT = 'light';
const THEME_DARK = 'dark';

/* variables */
var currentThemeMode = THEME_SYSTEM;
var isNight = false;

/* Theme */
function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? THEME_DARK : THEME_LIGHT;
}

function applyTheme(theme) {
    isNight = theme == 'dark';
    document.body.setAttribute('data-theme', theme);
    document.body.dispatchEvent(new CustomEvent('theme-change', {
        detail: {
            newTheme: currentThemeMode
        }
    }));    
}

function initTheme() {
    //const savedTheme = localStorage.getItem('theme');
    if (currentThemeMode != THEME_SYSTEM) {
        applyTheme(currentThemeMode);
    } else {
        const systemTheme = getSystemTheme();
        applyTheme(systemTheme);
    }

    if (window.resetHighlightTheme) {
        resetHighlightTheme();
    }
}

// init theme
initTheme();