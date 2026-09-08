/**
 * Compresses an image file and converts it to a base64 Data URL.
 * Resizes the image to a maximum dimension (default 600px) to keep DB payloads fast & lightweight.
 */
export const compressImageFile = (
  file: File,
  maxDimension = 600,
  quality = 0.85
): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      return reject(new Error('Selected file is not an image.'));
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return resolve(e.target?.result as string);
        }

        ctx.drawImage(img, 0, 0, width, height);

        // Export as WebP if supported, fallback to JPEG
        try {
          const webpData = canvas.toDataURL('image/webp', quality);
          if (webpData.startsWith('data:image/webp')) {
            return resolve(webpData);
          }
        } catch {
          // fallback
        }

        const jpegData = canvas.toDataURL('image/jpeg', quality);
        resolve(jpegData);
      };

      img.onerror = () => reject(new Error('Failed to load image file.'));
      img.src = e.target?.result as string;
    };

    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
};

/**
 * Returns a fallback category icon and aesthetic background gradient
 */
export const getCategoryVisual = (category = ''): { icon: string; gradient: string } => {
  const cat = category.toLowerCase();
  if (cat.includes('burger')) {
    return { icon: '🍔', gradient: 'linear-gradient(135deg, #78350f 0%, #451a03 100%)' };
  }
  if (cat.includes('pizza')) {
    return { icon: '🍕', gradient: 'linear-gradient(135deg, #991b1b 0%, #450a0a 100%)' };
  }
  if (cat.includes('appetizer') || cat.includes('wing') || cat.includes('starter')) {
    return { icon: '🍗', gradient: 'linear-gradient(135deg, #c2410c 0%, #7c2d12 100%)' };
  }
  if (cat.includes('side') || cat.includes('frie')) {
    return { icon: '🍟', gradient: 'linear-gradient(135deg, #b45309 0%, #78350f 100%)' };
  }
  if (cat.includes('salad') || cat.includes('healthy') || cat.includes('green')) {
    return { icon: '🥗', gradient: 'linear-gradient(135deg, #065f46 0%, #064e3b 100%)' };
  }
  if (cat.includes('beverage') || cat.includes('drink') || cat.includes('coffee') || cat.includes('tea')) {
    return { icon: '🍹', gradient: 'linear-gradient(135deg, #1e40af 0%, #1e1b4b 100%)' };
  }
  if (cat.includes('dessert') || cat.includes('cake') || cat.includes('sweet') || cat.includes('ice cream')) {
    return { icon: '🍰', gradient: 'linear-gradient(135deg, #831843 0%, #500724 100%)' };
  }
  if (cat.includes('bbq') || cat.includes('grill') || cat.includes('steak') || cat.includes('tikka') || cat.includes('kebab')) {
    return { icon: '🥩', gradient: 'linear-gradient(135deg, #881337 0%, #4c0519 100%)' };
  }
  if (cat.includes('main') || cat.includes('karahi') || cat.includes('handi') || cat.includes('curry') || cat.includes('biryani')) {
    return { icon: '🍲', gradient: 'linear-gradient(135deg, #854d0e 0%, #3f2c00 100%)' };
  }
  if (cat.includes('sandwich') || cat.includes('wrap') || cat.includes('roll')) {
    return { icon: '🥪', gradient: 'linear-gradient(135deg, #9a3412 0%, #431407 100%)' };
  }
  if (cat.includes('pasta') || cat.includes('noodle')) {
    return { icon: '🍝', gradient: 'linear-gradient(135deg, #a16207 0%, #713f12 100%)' };
  }

  return { icon: '🍽️', gradient: 'linear-gradient(135deg, #334155 0%, #1e293b 100%)' };
};
