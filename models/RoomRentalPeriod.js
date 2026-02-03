const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const RoomRentalPeriod = sequelize.define('RoomRentalPeriod', {
        period_id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        room_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        start_date: {
            type: DataTypes.DATEONLY,
            allowNull: false,
        },
        end_date: {
            type: DataTypes.DATEONLY,
            allowNull: true,
        },
        status: {
            type: DataTypes.ENUM('active', 'completed', 'cancelled'),
            defaultValue: 'active',
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
        },
    }, {
        tableName: 'room_rental_periods',
        timestamps: false,
    });

    RoomRentalPeriod.associate = (models) => {
        RoomRentalPeriod.belongsTo(models.Room, {
            foreignKey: 'room_id',
            as: 'room',
        });
    };

    return RoomRentalPeriod;
};
