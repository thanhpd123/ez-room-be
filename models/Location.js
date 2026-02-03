const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Location = sequelize.define('Location', {
        location_id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        address: {
            type: DataTypes.STRING(500),
            allowNull: false,
        },
        district: {
            type: DataTypes.STRING(100),
            allowNull: true,
        },
        city: {
            type: DataTypes.STRING(100),
            allowNull: false,
        },
        latitude: {
            type: DataTypes.DECIMAL(10, 8),
            allowNull: true,
        },
        longitude: {
            type: DataTypes.DECIMAL(11, 8),
            allowNull: true,
        },
    }, {
        tableName: 'locations',
        timestamps: false,
    });

    Location.associate = (models) => {
        Location.hasMany(models.Rental, {
            foreignKey: 'location_id',
            as: 'rentals',
        });
    };

    return Location;
};
