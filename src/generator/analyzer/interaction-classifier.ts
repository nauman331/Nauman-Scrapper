import * as cheerio from 'cheerio';
import type { DetectedInteraction } from '../types.js';

export class InteractionClassifier {
  /**
   * Scans HTML for common interactive patterns and classifies their feasibility in React
   */
  classifyInteractions(html: string): DetectedInteraction[] {
    const $ = cheerio.load(html, null, false);
    const interactions: DetectedInteraction[] = [];

    // 1. Mobile Menu / Navbar toggles
    const navToggles = $('[data-toggle="collapse"], [data-bs-toggle="collapse"], .navbar-toggler, .hamburger, [aria-label*="menu" i], button.menu-btn');
    if (navToggles.length > 0) {
      interactions.push({
        type: 'mobile-nav',
        selector: navToggles.first().attr('class') || 'button.navbar-toggler',
        classification: 2, // Requiring adaptation to React state
        description: 'Mobile navigation toggle detected. Adapted to React useState hook for expand/collapse.',
        componentName: 'MobileNav',
      });
    }

    // 2. Dropdowns / Mega Menus
    const dropdowns = $('.dropdown, [data-toggle="dropdown"], [data-bs-toggle="dropdown"], .has-dropdown, details.dropdown');
    if (dropdowns.length > 0) {
      interactions.push({
        type: 'dropdown',
        selector: '.dropdown',
        classification: 2,
        description: 'Interactive dropdown menus detected. Adapted to React state and click-outside listeners.',
        componentName: 'Dropdown',
      });
    }

    // 3. Accordions / Collapse
    const accordions = $('.accordion, .accordion-item, details, [data-accordion]');
    if (accordions.length > 0) {
      interactions.push({
        type: 'accordion',
        selector: '.accordion',
        classification: 2,
        description: 'Accordion / collapsible sections detected. Adapted to React controlled component.',
        componentName: 'Accordion',
      });
    }

    // 4. Modals / Dialogs
    const modals = $('.modal, [role="dialog"], dialog, [data-toggle="modal"], [data-bs-toggle="modal"]');
    if (modals.length > 0) {
      interactions.push({
        type: 'modal',
        selector: '.modal',
        classification: 2,
        description: 'Modal dialogs detected. Adapted to React Portal / useState pattern.',
        componentName: 'Modal',
      });
    }

    // 5. Tabs
    const tabs = $('[role="tablist"], .nav-tabs, [data-toggle="tab"], [data-bs-toggle="tab"]');
    if (tabs.length > 0) {
      interactions.push({
        type: 'tabs',
        selector: '[role="tablist"]',
        classification: 2,
        description: 'Tab navigation detected. Adapted to active tab state tracking.',
        componentName: 'Tabs',
      });
    }

    // 6. Carousels / Sliders
    const carousels = $('.carousel, .swiper, .slick-slider, .owl-carousel, [data-carousel]');
    if (carousels.length > 0) {
      interactions.push({
        type: 'carousel',
        selector: '.carousel',
        classification: 2,
        description: 'Carousel / slider detected. Converted to a clean React slide carousel with prev/next buttons.',
        componentName: 'Carousel',
      });
    }

    // 7. Forms (search, newsletter, contact)
    $('form').each((_, el) => {
      const action = $(el).attr('action') || '';
      const hasInputs = $(el).find('input, textarea, select').length > 0;

      if (hasInputs) {
        const isExternalBackend = action.startsWith('http') || action.includes('/api/') || action.includes('.php');
        interactions.push({
          type: 'form',
          selector: `form[action="${action || '#' }"]`,
          classification: isExternalBackend ? 3 : 2, // 3: Dependent on backend, 2: Client adaptation
          description: isExternalBackend
            ? `Form submitting to ${action}. Marked as backend-dependent; client-side placeholder event handler generated.`
            : 'Client-side interactive form with validation and submit state.',
          componentName: 'Form',
        });
      }
    });

    return interactions;
  }
}

export const interactionClassifier = new InteractionClassifier();
