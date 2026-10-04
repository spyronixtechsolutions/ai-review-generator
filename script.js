/* ================= DOCTOR DATABASE ================= */
const doctors = {
  mukundagrawal: {
    name: "Dr. Mukund Agrawal",
    links: {
      Nagpur: "https://g.page/r/CfKOK0J3yq2vEBE/review",
      Itarsi: "https://g.page/r/CWUODJ90WG1rEBE/review",
      Betul: "https://g.page/r/CQMT68pfmtDcEBI/review"
    }
  },

  ibocc: {
    name: "i-BOCC Cancer Center",
    links: {
      Sambhajinagar: "https://g.page/r/CTjDCglmbMSQEAE/review"
    }
  },

  abhishekbhalotia: {
    name: "Dr. Abhishek Bhalotia",
    links: {
      Gondia: "https://g.page/r/CbQZZElmOXyTEAE/review"
    }
  },

  vishalchandak: {
    name: "Dr. Vishal Chandak",
    links: {
      Sambhajinagar: "https://g.page/r/CXFIHvG3sWhIEAE/review"
    }
  },

  // ADDED DR. SANDEEP
  drsandeep: {
    name: "Dr. Sandeep's Eye Clinic",
    links: {
      Sambhajinagar: "https://g.page/r/CXFIHvG3sWhIEAE/review" // Replace with Dr. Sandeep's Google Review Link
    }
  }
};

let currentDoctor = null;
let lastReviews = [];
window.lastPayloadStr = "";
window.lastResult = null;

/* ================= ON LOAD INITIALIZATION ================= */
window.onload = function () {
  const doctorInput = document.getElementById("doctor");
  const locationDropdown = document.getElementById("location");

  // Get path identifier (e.g., 'drsandeep' from domain.com/drsandeep)
  const doctorId = window.location.pathname.substring(1).toLowerCase().replace(/\/$/, "");

  if (doctorId && doctors[doctorId]) {
    currentDoctor = doctors[doctorId];

    // Populate Doctor Name
    if (doctorInput) {
      doctorInput.value = currentDoctor.name;
    }

    // Populate Locations
    if (locationDropdown) {
      locationDropdown.innerHTML = "";
      Object.keys(currentDoctor.links).forEach(location => {
        const option = document.createElement("option");
        option.value = location;
        option.textContent = location;
        locationDropdown.appendChild(option);
      });
    }
  } else {
    // FALLBACK: If URL path is not found or empty
    if (doctorInput) {
      doctorInput.removeAttribute("readonly");
      doctorInput.placeholder = "Enter Clinic/Hospital Name";
    }
    
    if (locationDropdown) {
      locationDropdown.innerHTML = '<option value="Default Branch">Default Branch</option>';
    }
  }
};

/* ================= GENERATE REVIEW ================= */
async function generateReview() {
  const doctor = document.getElementById("doctor")?.value.trim() || "";
  const specificDoctor = document.getElementById("specific-doctor")?.value.trim() || "";
  const location = document.getElementById("location")?.value || "";
  const treatment = document.getElementById("treatment")?.value.trim() || "";
  
  // Always default to Excellent
  const comment = "Excellent"; 
  
  const length = document.getElementById("length")?.value || "medium";
  const language = document.getElementById("language")?.value || "English";
  
  const loading = document.getElementById("loading");
  const generateBtn = document.querySelector('.generate-btn');

  // Validation Check
  if (!doctor || !location || !treatment) {
    alert("Please enter the Treatment Received to continue.");
    return;
  }

  const payload = {
    doctor,
    specificDoctor, 
    location,
    treatment,
    comment, 
    length,
    language
  };

  const payloadStr = JSON.stringify(payload);

  // Return cached result if same query is fired again
  if (window.lastPayloadStr === payloadStr && window.lastResult) {
    await displayReviews(window.lastResult);
    return;
  }

  // Disable button while processing
  if (generateBtn) {
    generateBtn.disabled = true;
    generateBtn.style.opacity = "0.7";
    generateBtn.innerText = "Generating...";
  }
  
  if (loading) {
    loading.classList.remove("hidden");
  }

  try {
    const response = await fetch("/.netlify/functions/generate-review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!result.review) {
      if (result.details?.error?.code === 429) {
        alert("AI service is busy. Please wait 1 minute and try again.");
      } else if (result.details?.error?.code === 503) {
        alert("AI service is temporarily unavailable. Please try again shortly.");
      } else {
        alert("Unable to generate review. Please try again.");
      }
      console.log(result);
      return;
    }

    // Cache successful response
    window.lastPayloadStr = payloadStr;
    window.lastResult = result.review;

    await displayReviews(result.review);

  } catch (error) {
    console.error(error);
    alert("Error generating review.");
  } finally {
    if (loading) loading.classList.add("hidden");
    if (generateBtn) {
      generateBtn.disabled = false;
      generateBtn.style.opacity = "1";
      generateBtn.innerText = "Generate Review";
    }
  }
}

/* ================= DISPLAY REVIEWS ================= */
async function displayReviews(textBlock) {
  const reviewsContainer = document.getElementById("reviews");
  if (!reviewsContainer) return;
  
  reviewsContainer.innerHTML = "";

  const reviewList = textBlock
    .split(/\n\s*\n/)
    .map(r => r.trim())
    .filter(r => r.length > 20);

  let uniqueReviews = [];

  reviewList.forEach(review => {
    if (!isDuplicate(review) && !isTooSimilar(review, uniqueReviews)) {
      uniqueReviews.push(review);
      lastReviews.push(review);
    }
  });

  if (uniqueReviews.length === 0) {
    alert("Duplicate detected. Regenerating...");
    generateReview();
    return;
  }

  // Type all reviews concurrently
  await Promise.all(
    uniqueReviews.map(review => typeReview(review, reviewsContainer))
  );
}

/* ================= TYPING ANIMATION ================= */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function typeReview(text, container) {
  const div = document.createElement("div");
  div.className = "review-card";

  const p = document.createElement("p");
  div.appendChild(p);

  container.appendChild(div);

  // Typewriter effect
  for (let i = 0; i < text.length; i++) {
    p.textContent += text.charAt(i);
    await sleep(12);
  }

  // Post & Copy action buttons
  const buttonWrapper = document.createElement("div");
  buttonWrapper.style.marginTop = "12px";
  buttonWrapper.style.display = "flex";
  buttonWrapper.style.gap = "8px";

  const copyBtn = document.createElement("button");
  copyBtn.innerText = "Copy Review";
  copyBtn.onclick = () => copyText(text);

  const postBtn = document.createElement("button");
  postBtn.innerText = "Post on Google";
  postBtn.onclick = () => postGoogle();

  buttonWrapper.appendChild(copyBtn);
  buttonWrapper.appendChild(postBtn);
  div.appendChild(buttonWrapper);

  await sleep(200);
}

/* ================= COPY & POST ACTIONS ================= */
function copyText(text) {
  navigator.clipboard.writeText(text);
  alert("Review copied to clipboard!");
}

function postGoogle() {
  const location = document.getElementById("location")?.value;

  if (!currentDoctor) {
    alert("Doctor review link not configured.");
    return;
  }

  const reviewLink = currentDoctor.links[location];

  if (reviewLink) {
    window.open(reviewLink, "_blank");
  } else {
    alert("Review link not available for this location.");
  }
}

/* ================= DUPLICATE CHECKS ================= */
function isDuplicate(review) {
  return lastReviews.includes(review);
}

function isTooSimilar(newReview, existingReviews) {
  return existingReviews.some(oldReview => {
    const similarity = calculateSimilarity(newReview, oldReview);
    return similarity > 0.8;
  });
}

function calculateSimilarity(str1, str2) {
  const words1 = str1.toLowerCase().split(/\W+/);
  const words2 = str2.toLowerCase().split(/\W+/);

  const set1 = new Set(words1);
  const set2 = new Set(words2);

  const intersection = new Set([...set1].filter(x => set2.has(x)));

  return intersection.size / Math.max(set1.size, set2.size);
}
