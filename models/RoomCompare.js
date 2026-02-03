const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const RoomCompare = sequelize.define('RoomCompare', {
        recommendation_id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        room_id: {
            type: DataTypes.UUID,
            allowNull: false,
            unique: true,
        },
        area_avg_price: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: true,
        },
        price_diff_percent: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: true,
        },
        price_level: {
            type: DataTypes.ENUM('low', 'average', 'high'),
            allowNull: true,
        },
        updated_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
        },
    }, {
        tableName: 'room_compares',
        timestamps: false,
    });

    RoomCompare.associate = (models) => {
        RoomCompare.belongsTo(models.Room, {
            foreignKey: 'room_id',
            as: 'room',
        });
    };

    return RoomCompare;
};
