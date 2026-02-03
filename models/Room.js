const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Room = sequelize.define('Room', {
        room_id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        rental_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        title: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        price: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
        },
        area: {
            type: DataTypes.DECIMAL(8, 2),
            allowNull: true,
        },
        max_occupants: {
            type: DataTypes.INTEGER,
            defaultValue: 1,
        },
        status: {
            type: DataTypes.ENUM('available', 'rented', 'maintenance'),
            defaultValue: 'available',
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
        },
    }, {
        tableName: 'rooms',
        timestamps: false,
    });

    Room.associate = (models) => {
        Room.belongsTo(models.Rental, {
            foreignKey: 'rental_id',
            as: 'rental',
        });
        Room.hasMany(models.RoomImage, {
            foreignKey: 'room_id',
            as: 'images',
        });
        Room.belongsToMany(models.Amenity, {
            through: 'room_amenities',
            foreignKey: 'room_id',
            otherKey: 'amenity_id',
            as: 'amenities',
        });
        Room.hasMany(models.RoomRentalPeriod, {
            foreignKey: 'room_id',
            as: 'rentalPeriods',
        });
        Room.hasOne(models.RoomCompare, {
            foreignKey: 'room_id',
            as: 'compare',
        });
        Room.hasMany(models.FavoriteRoom, {
            foreignKey: 'room_id',
            as: 'favorites',
        });
        Room.hasMany(models.Preorder, {
            foreignKey: 'room_id',
            as: 'preorders',
        });
    };

    return Room;
};
