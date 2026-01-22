class ProductDetector {
    constructor() {
        this.selectors = [
            '.s-result-item[data-asin]', // Search results
            '#ppd', // Product Detail Page (main container)
            '.a-carousel-card', // Carousel items (related products)
            '.a-cardui', // Generic cards
        ];
    }

    /**
     * Traverses up from the target element to find the nearest Product Card.
     * @param {HTMLElement} element 
     * @returns {HTMLElement | null}
     */
    findProductCard(element) {
        if (!element) return null;

        for (const selector of this.selectors) {
            const card = element.closest(selector);
            if (card) {
                // Filter out empty or structural cards if necessary
                if (card.hasAttribute('data-asin')) return card;

                // If searching on detail page, the #ppd is the product itself
                if (card.id === 'ppd') return card;
            }
        }
        return null;
    }

    getProductId(card) {
        if (!card) return null;
        // Search results usually have data-asin
        if (card.dataset.asin) return card.dataset.asin;

        // Detail page: the ASIN might be in the URL or a hidden input.
        // For current MVP, focus on search results.
        return null;
    }
}
