(() => {
  function mount(root) {
    const lifecycle = new AbortController();
    let slotRequest;
    let services = [];
    const serviceInput = root.querySelector("[data-appt-service]");
    const dateInput = root.querySelector("[data-appt-date]");
    const description = root.querySelector("[data-appt-description]");
    const price = root.querySelector("[data-appt-price]");
    const zone = root.querySelector("[data-appt-timezone]");
    const status = root.querySelector("[data-appt-status]");
    const slots = root.querySelector("[data-appt-slots]");
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Keep requests on the storefront origin.
    const proxyPath = root.dataset.proxy || "/apps/appointments";

    async function get(path, query, signal) {
      const proxy = new URL(proxyPath.replace(/\/+$/, "") + "/", location.origin);
      if (proxy.origin !== location.origin || !proxyPath.startsWith("/"))
        throw new Error("Invalid app proxy path");
      const url = new URL(path, proxy);
      url.search = new URLSearchParams(query).toString();
      const response = await fetch(url, {
        signal,
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Booking unavailable");
      return response.json();
    }

    async function loadSlots() {
      slotRequest?.abort();
      slots.replaceChildren();
      zone.textContent = "";
      const service = services.find(
        (item) => item.handle === serviceInput.value,
      );
      dateInput.disabled = !service;
      description.textContent = service?.description || "";
      description.hidden = !description.textContent;
      price.textContent = service?.priceNote || "";
      price.hidden = !price.textContent;
      if (!service || !dateInput.value) {
        status.textContent =
          "Choose a Service and a date to see available times.";
        return;
      }
      const selectedDate = dateInput.value;
      const day = Date.parse(selectedDate + "T00:00:00Z");
      if (!Number.isFinite(day)) return;
      slotRequest = new AbortController();
      const { signal } = slotRequest;
      status.textContent = "Loading available times…";
      try {
        // Cover the selected day in every IANA zone, plus a full-day Slot end.
        // Filter by the proxy's display timezone, never the browser's date.
        const result = await get(
          "slots",
          {
            service: service.handle,
            from: new Date(day - 86400000).toISOString(),
            to: new Date(day + 3 * 86400000).toISOString(),
            timezone: browserZone,
          },
          signal,
        );
        if (signal.aborted) return;
        const dateFormat = new Intl.DateTimeFormat("en-US", {
          timeZone: result.timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        const timeFormat = new Intl.DateTimeFormat(undefined, {
          timeZone: result.timeZone,
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "shortOffset",
        });
        zone.textContent = `Times shown in ${result.timeZone}.`;
        const fragment = document.createDocumentFragment();
        for (const slot of result.slots) {
          const start = new Date(slot.start);
          const parts = dateFormat.formatToParts(start);
          const date = ["year", "month", "day"]
            .map((type) => parts.find((part) => part.type === type).value)
            .join("-");
          if (date !== selectedDate) continue;
          const button = document.createElement("button");
          button.type = "button";
          button.setAttribute("aria-pressed", "false");
          const startTime = document.createElement("time");
          startTime.dateTime = slot.start;
          startTime.textContent = timeFormat.format(start);
          const endTime = document.createElement("time");
          endTime.dateTime = slot.end;
          endTime.textContent = timeFormat.format(new Date(slot.end));
          button.append(startTime, " – ", endTime);
          button.addEventListener("click", () => {
            for (const other of slots.querySelectorAll("button"))
              other.setAttribute("aria-pressed", String(other === button));
            status.textContent = `Selected: ${button.textContent}.`;
          });
          fragment.append(button);
        }
        status.textContent = fragment.childElementCount
          ? "Choose an available time."
          : "No available times on this date. Try another date.";
        slots.replaceChildren(fragment);
      } catch {
        if (!signal.aborted) {
          slots.replaceChildren();
          zone.textContent = "";
          status.textContent = "Booking unavailable. Please try again later.";
        }
      }
    }

    serviceInput.replaceChildren(new Option("Choose a Service", ""));
    serviceInput.disabled = true;
    dateInput.disabled = true;
    dateInput.value = "";
    slots.replaceChildren();
    zone.textContent = "";
    description.hidden = price.hidden = true;
    status.textContent = "Loading Services…";
    serviceInput.addEventListener("change", loadSlots, {
      signal: lifecycle.signal,
    });
    dateInput.addEventListener("change", loadSlots, {
      signal: lifecycle.signal,
    });
    get("services", { services: root.dataset.services || "" }, lifecycle.signal)
      .then((result) => {
        if (lifecycle.signal.aborted) return;
        services = result.services;
        for (const service of services)
          serviceInput.add(new Option(service.name, service.handle));
        serviceInput.disabled = !services.length;
        status.textContent = services.length
          ? "Choose a Service and a date to see available times."
          : "No Services available.";
      })
      .catch(() => {
        if (!lifecycle.signal.aborted)
          status.textContent = "Booking unavailable. Please try again later.";
      });
    return () => {
      lifecycle.abort();
      slotRequest?.abort();
    };
  }

  function register() {
    if (customElements.get("appointments-widget")) return;
    customElements.define(
      "appointments-widget",
      class extends HTMLElement {
        connectedCallback() {
          this.cleanup = mount(this);
        }
        disconnectedCallback() {
          this.cleanup?.();
        }
      },
    );
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", register, { once: true });
  else register();
})();
