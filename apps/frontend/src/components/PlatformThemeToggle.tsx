import React, { useEffect, useState } from 'react';

const PlatformThemeToggle: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    localStorage.getItem('pos_theme') === 'light' ? 'light' : 'dark'
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pos_theme', theme);
  }, [theme]);

  return (
    <button
      type="button"
      className={`platform-theme-toggle ${className}`}
      onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
    >
      {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
    </button>
  );
};

export default PlatformThemeToggle;
