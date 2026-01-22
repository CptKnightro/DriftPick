class ScoringManager {
    constructor() {
        this.products = {}; // { asin: { totalTime: 0, lastSeen: 0, visits: 0, score: 0, injected: false } }
        this.currentAsin = null;
        this.lastFrameTime = 0;
    }

    /**
     * Called every frame with the ID of the product being looked at (or null).
     * @param {string | null} asin 
     * @param {number} timestamp 
     */
    update(asin, timestamp) {
        const delta = timestamp - this.lastFrameTime;
        this.lastFrameTime = timestamp;

        if (delta > 500) return; // Ignore large jumps (lag/tab switch)

        if (asin) {
            if (!this.products[asin]) {
                this.products[asin] = { totalTime: 0, lastSeen: 0, visits: 0, score: 0, injected: false };
            }

            const p = this.products[asin];

            // If we just switched to this product (after being away for > 500ms), count a visit
            if (timestamp - p.lastSeen > 500) {
                p.visits++;
                // console.log(`Visited ${asin} (${p.visits} times)`);
            }

            p.lastSeen = timestamp;
            p.totalTime += delta;

            // Recalculate Score
            this.calculateScore(asin);
        }

        this.currentAsin = asin;
    }

    calculateScore(asin) {
        const p = this.products[asin];

        // Formulate a score 0-100
        // Base: 1 second = 20 points. Cap at 80 points (4 seconds).
        let timeScore = Math.min(80, (p.totalTime / 4000) * 80);

        // Visits: 5 points per return visit.
        let visitScore = Math.min(20, (p.visits - 1) * 5);
        if (visitScore < 0) visitScore = 0;

        p.score = Math.floor(timeScore + visitScore);

        // Inject/Update UI
        this.renderScore(asin, p.score);
    }

    renderScore(asin, score) {
        // Find the card again (this is expensive, maybe we should cache the element reference?)
        // For MVP, simple query is fine if we use specific selector
        const card = document.querySelector(`.s-result-item[data-asin="${asin}"]`);
        if (!card) return;

        let badge = document.getElementById(`drift-score-${asin}`);

        // Create Badge if missing
        if (!badge) {
            badge = document.createElement("div");
            badge.id = `drift-score-${asin}`;
            badge.style.position = "absolute";
            badge.style.top = "10px";
            badge.style.right = "10px";
            badge.style.width = "40px";
            badge.style.height = "40px";
            badge.style.borderRadius = "50%";
            badge.style.backgroundColor = "rgba(0,0,0,0.8)";
            badge.style.color = "white";
            badge.style.display = "flex";
            badge.style.alignItems = "center";
            badge.style.justifyContent = "center";
            badge.style.fontWeight = "bold";
            badge.style.fontSize = "14px";
            badge.style.border = "2px solid #333";
            badge.style.zIndex = "100";
            badge.style.transition = "all 0.3s ease";

            // Try to append to image container or main card
            // Amazon specific: .s-image-container or just the card
            const imgContainer = card.querySelector('.s-image-container') || card;
            imgContainer.style.position = 'relative'; // Ensure relative parent
            imgContainer.appendChild(badge);
        }

        // Update Visuals
        badge.innerText = score;

        // Color Grade
        if (score < 30) {
            badge.style.borderColor = "#ccc"; // Grey
            badge.style.color = "#ccc";
        } else if (score < 60) {
            badge.style.borderColor = "orange";
            badge.style.color = "orange";
        } else {
            badge.style.borderColor = "#00ff00"; // Green
            badge.style.color = "#00ff00";
            badge.style.boxShadow = "0 0 10px #00ff00";
            badge.style.transform = "scale(1.1)";
        }
    }
}
