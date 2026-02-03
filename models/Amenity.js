const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Amenity = sequelize.define('Amenity', {
        amenity_id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        name: {
            type: DataTypes.STRING(100),
            allowNull: false,
            unique: true,
        },
        icon: {
            type: DataTypes.STRING(100),
            allowNull: true,
        },
    }, {
        tableName: 'amenities',
        timestamps: false,
    });

    Amenity.associate = (models) => {
        Amenity.belongsToMany(models.Room, {
            through: 'room_amenities',
            foreignKey: 'amenity_id',
            otherKey: 'room_id',
            as: 'rooms',
        });
    };

    return Amenity;
};
