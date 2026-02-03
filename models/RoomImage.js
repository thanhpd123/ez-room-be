const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const RoomImage = sequelize.define('RoomImage', {
        image_id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        room_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        image_url: {
            type: DataTypes.STRING(500),
            allowNull: false,
        },
    }, {
        tableName: 'room_images',
        timestamps: false,
    });

    RoomImage.associate = (models) => {
        RoomImage.belongsTo(models.Room, {
            foreignKey: 'room_id',
            as: 'room',
        });
    };

    return RoomImage;
};
