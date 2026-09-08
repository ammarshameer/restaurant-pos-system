import React, { useState } from 'react';
import { MenuCategory, MenuItem } from '../types/menu.types';
import { formatPKR } from '../utils/format';

interface MenuBrowserProps {
  categories: MenuCategory[];
  onSelectItem: (item: MenuItem, quantity: number) => void;
}

export const MenuBrowser: React.FC<MenuBrowserProps> = ({
  categories,
  onSelectItem,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(
    categories[0]?.id || null
  );
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const handleAddItem = (item: MenuItem) => {
    const quantity = quantities[item.id] || 1;
    onSelectItem(item, quantity);
    setQuantities({ ...quantities, [item.id]: 1 });
  };

  const currentCategory = categories.find((cat) => cat.id === selectedCategory);

  return (
    <div className="menu-browser">
      <div className="category-tabs">
        {categories.map((category) => (
          <button
            key={category.id}
            onClick={() => setSelectedCategory(category.id)}
            className={`category-tab ${
              selectedCategory === category.id ? 'active' : ''
            }`}
          >
            {category.name}
          </button>
        ))}
      </div>

      <div className="menu-items">
        {currentCategory?.items.map((item) => (
          <div key={item.id} className="menu-item">
            {item.image && (
              <img
                src={item.image}
                alt={item.name}
                className="item-image"
              />
            )}
            <div className="item-details">
              <h4>{item.name}</h4>
              {item.description && (
                <p className="description">{item.description}</p>
              )}
              <div className="item-meta">
                {item.preparationTime && (
                  <span className="prep-time">
                    {item.preparationTime} min
                  </span>
                )}
                {item.calories && (
                  <span className="calories">{item.calories} cal</span>
                )}
              </div>
              {item.allergens && item.allergens.length > 0 && (
                <div className="allergens">
                  Allergens: {item.allergens.join(', ')}
                </div>
              )}
            </div>
            <div className="item-actions">
              <div className="price">{formatPKR(item.price)}</div>
              <div className="quantity-selector">
                <button
                  onClick={() =>
                    setQuantities({
                      ...quantities,
                      [item.id]: Math.max(1, (quantities[item.id] || 1) - 1),
                    })
                  }
                  className="btn-qty"
                >
                  -
                </button>
                <span>{quantities[item.id] || 1}</span>
                <button
                  onClick={() =>
                    setQuantities({
                      ...quantities,
                      [item.id]: (quantities[item.id] || 1) + 1,
                    })
                  }
                  className="btn-qty"
                >
                  +
                </button>
              </div>
              <button
                onClick={() => handleAddItem(item)}
                className="btn btn-add"
                disabled={!item.isAvailable}
              >
                {item.isAvailable ? 'Add' : 'Unavailable'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
