/**
 * Seed Index - Export tất cả seed modules
 */

const { seedUsers, usersData } = require('./users');
const { seedLocations, locationsData } = require('./locations');
const { seedAmenities, amenitiesData } = require('./amenities');
const { seedRentals, rentalsData, sampleImages } = require('./rentals');

module.exports = {
    // Seed functions
    seedUsers,
    seedLocations,
    seedAmenities,
    seedRentals,

    // Raw data (để có thể customize)
    data: {
        users: usersData,
        locations: locationsData,
        amenities: amenitiesData,
        rentals: rentalsData,
        sampleImages,
    },
};
