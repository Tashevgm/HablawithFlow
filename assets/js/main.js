const SEED_REVIEWS = [
  {
    name: "Sarah Johnson",
    role: "Marketing Executive",
    lesson: "1-on-1",
    rating: 5,
    color: "teal",
    text: "Vlad made learning feel like a conversation with a friend. The focus on rhythm and flow changed everything for me."
  },
  {
    name: "Michael Chen",
    role: "Travel Enthusiast",
    lesson: "Travel Spanish",
    rating: 5,
    color: "gold",
    text: "I finally felt confident on my trip to Mexico. We practiced real scenarios that I actually used every day."
  }
];

const AVATAR_COLORS = ["teal", "gold", "red", "blue", "purple", "green"];
const STORAGE_KEY = "hwf_reviews";

let selectedRating = 0;

function getInitials(name) {
  return name
    .trim()
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function starsHtml(rating) {
  return Array.from({ length: 5 }, (_, index) => {
    return `<span class="star${index < rating ? "" : " empty"}">&#9733;</span>`;
  }).join("");
}

function loadReviews() {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
}

function saveReviews(reviews) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reviews));
}

function allReviews() {
  return [...SEED_REVIEWS, ...loadReviews()];
}

function renderCard(review) {
  const initials = getInitials(review.name);
  const color =
    review.color ||
    AVATAR_COLORS[Math.abs(review.name.charCodeAt(0) - 65) % AVATAR_COLORS.length];

  return `
    <article class="testi-card">
      <div class="testi-card-top">
        <div class="testi-quote">"</div>
        <div class="testi-stars">${starsHtml(review.rating)}</div>
      </div>
      <p>${review.text}</p>
      <div class="testi-author">
        <div class="testi-avatar ${color}">${initials}</div>
        <div>
          <div class="testi-name">${review.name}</div>
          <div class="testi-role">${review.role || "Student"}</div>
          ${review.lesson ? `<span class="testi-lesson-tag">${review.lesson}</span>` : ""}
        </div>
      </div>
    </article>
  `;
}

function renderSummary(reviews) {
  const total = reviews.length;
  const average = total
    ? (reviews.reduce((sum, review) => sum + review.rating, 0) / total).toFixed(1)
    : "0.0";

  document.getElementById("avg-score").textContent = average;
  document.getElementById("review-count").textContent = `${total} review${total === 1 ? "" : "s"}`;

  const bars = [5, 4, 3, 2, 1]
    .map((rating) => {
      const count = reviews.filter((review) => review.rating === rating).length;
      const percentage = total ? Math.round((count / total) * 100) : 0;

      return `
        <div class="bar-row">
          <span class="bar-label">${rating}&#9733;</span>
          <div class="bar-track"><div class="bar-fill" style="width:${percentage}%"></div></div>
          <span class="bar-count">${count}</span>
        </div>
      `;
    })
    .join("");

  document.getElementById("summary-bars").innerHTML = bars;
}

function renderAll() {
  const reviews = allReviews();
  document.getElementById("reviews-grid").innerHTML = reviews.map(renderCard).join("");
  renderSummary(reviews);
}

function switchTab(tab) {
  const isReadTab = tab === "read";

  document.querySelectorAll(".tab-btn").forEach((button) => {
    const isActive = button.dataset.tab === tab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  const readPanel = document.getElementById("tab-read");
  const writePanel = document.getElementById("tab-write");

  readPanel.classList.toggle("active", isReadTab);
  writePanel.classList.toggle("active", !isReadTab);
  readPanel.hidden = !isReadTab;
  writePanel.hidden = isReadTab;

  if (isReadTab) {
    renderAll();
  }
}

function showError(message) {
  const errorElement = document.getElementById("rv-error");
  errorElement.textContent = message;
  errorElement.hidden = false;
}

function clearError() {
  const errorElement = document.getElementById("rv-error");
  errorElement.textContent = "";
  errorElement.hidden = true;
}

function setStarPreview(rating) {
  document.querySelectorAll(".sp-star").forEach((star) => {
    star.classList.toggle("lit", Number(star.dataset.val) <= rating);
  });
}

function submitReview() {
  const name = document.getElementById("rv-name").value.trim();
  const role = document.getElementById("rv-role").value.trim();
  const lesson = document.getElementById("rv-lesson").value;
  const text = document.getElementById("rv-text").value.trim();

  if (!name) {
    showError("Please enter your name.");
    return;
  }

  if (!selectedRating) {
    showError("Please choose a star rating.");
    return;
  }

  if (!text) {
    showError("Please write a short review.");
    return;
  }

  clearError();

  const reviews = loadReviews();
  reviews.push({ name, role, lesson, rating: selectedRating, text });
  saveReviews(reviews);

  document.getElementById("review-form").hidden = true;
  document.getElementById("review-success").hidden = false;
}

function bindReviewControls() {
  document.querySelectorAll(".tab-btn").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  document.querySelectorAll(".sp-star").forEach((star) => {
    star.addEventListener("mouseover", () => setStarPreview(Number(star.dataset.val)));
    star.addEventListener("focus", () => setStarPreview(Number(star.dataset.val)));
    star.addEventListener("mouseout", () => setStarPreview(selectedRating));
    star.addEventListener("blur", () => setStarPreview(selectedRating));
    star.addEventListener("click", () => {
      selectedRating = Number(star.dataset.val);
      setStarPreview(selectedRating);
      clearError();
    });
  });

  document.getElementById("submit-review").addEventListener("click", submitReview);
  document.getElementById("read-reviews").addEventListener("click", () => switchTab("read"));
}

function bindBookingForm() {
  const bookingForm = document.querySelector(".booking-form");

  bookingForm.addEventListener("submit", (event) => {
    event.preventDefault();
  });
}

function init() {
  renderAll();
  bindReviewControls();
  bindBookingForm();
}

init();
