const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Rental = sequelize.define('Rental', {
        rental_id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        user_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        location_id: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        title: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        summary: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        available_room: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
        },
        status: {
            type: DataTypes.ENUM('AVAILABLE', 'UNAVAILABLE', 'HIDDEN', 'VIOLATE', 'PENDING', 'SUSPEND'),
            defaultValue: 'PENDING',
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
        },
    }, {
        tableName: 'rentals',
        timestamps: false,
    });

    Rental.associate = (models) => {
        Rental.belongsTo(models.User, {
            foreignKey: 'user_id',
            as: 'owner',
        });
        Rental.belongsTo(models.Location, {
            foreignKey: 'location_id',
            as: 'location',
        });
        Rental.hasMany(models.Room, {
            foreignKey: 'rental_id',
            as: 'rooms',
        });
    };

    return Rental;
};
